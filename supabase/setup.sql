-- ============================================================
-- اختبر معلوماتك العسكرية (فوج الحماية)
-- إعداد قاعدة بيانات Supabase وسياسات الحماية
-- تصميم وإعداد: محمود عبد المعطي الأحمد
-- شغّل هذا الملف كاملًا مرة واحدة داخل Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'المدير',
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  icon text not null default '📚',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  type text not null check (type in ('mcq', 'true_false', 'fill', 'text')),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard', 'trainer')),
  prompt text not null check (char_length(prompt) between 2 and 800),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  accepted_answers jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_answers) = 'array'),
  explanation text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  participant_name text not null check (char_length(participant_name) between 2 and 80),
  participant_rank text,
  participant_unit text,
  category_slug text not null,
  question_type text not null,
  difficulty text not null,
  question_count integer not null check (question_count between 1 and 500),
  correct_count integer not null check (correct_count >= 0),
  wrong_count integer not null check (wrong_count >= 0),
  score numeric(5,2) not null check (score between 0 and 100),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  answers jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  user_agent text,
  created_at timestamptz not null default now(),
  constraint result_counts_match check (correct_count + wrong_count = question_count)
);

create index if not exists idx_categories_active_order on public.categories(active, sort_order);
create index if not exists idx_questions_category on public.questions(category_id);
create index if not exists idx_questions_filters on public.questions(active, type, difficulty);
create index if not exists idx_results_created_at on public.results(created_at desc);
create index if not exists idx_results_participant_name on public.results(participant_name);

-- تحديث updated_at تلقائيًا

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists questions_set_updated_at on public.questions;
create trigger questions_set_updated_at before update on public.questions
for each row execute function public.set_updated_at();

-- دالة آمنة للتحقق من المدير
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- تفعيل Row Level Security
alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.questions enable row level security;
alter table public.results enable row level security;

-- تنظيف السياسات القديمة لتسهيل إعادة تشغيل الملف

drop policy if exists "User can read own admin row" on public.admin_users;
drop policy if exists "Public reads active categories" on public.categories;
drop policy if exists "Admins read all categories" on public.categories;
drop policy if exists "Admins insert categories" on public.categories;
drop policy if exists "Admins update categories" on public.categories;
drop policy if exists "Admins delete categories" on public.categories;
drop policy if exists "Public reads active questions" on public.questions;
drop policy if exists "Admins read all questions" on public.questions;
drop policy if exists "Admins insert questions" on public.questions;
drop policy if exists "Admins update questions" on public.questions;
drop policy if exists "Admins delete questions" on public.questions;
drop policy if exists "Anyone inserts results" on public.results;
drop policy if exists "Admins read results" on public.results;
drop policy if exists "Admins delete results" on public.results;

create policy "User can read own admin row"
on public.admin_users for select
to authenticated
using (user_id = auth.uid());

create policy "Public reads active categories"
on public.categories for select
to anon, authenticated
using (active = true);

create policy "Admins read all categories"
on public.categories for select
to authenticated
using (public.is_admin());

create policy "Admins insert categories"
on public.categories for insert
to authenticated
with check (public.is_admin());

create policy "Admins update categories"
on public.categories for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins delete categories"
on public.categories for delete
to authenticated
using (public.is_admin());

create policy "Public reads active questions"
on public.questions for select
to anon, authenticated
using (
  active = true
  and exists (
    select 1 from public.categories c
    where c.id = category_id and c.active = true
  )
);

create policy "Admins read all questions"
on public.questions for select
to authenticated
using (public.is_admin());

create policy "Admins insert questions"
on public.questions for insert
to authenticated
with check (public.is_admin());

create policy "Admins update questions"
on public.questions for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins delete questions"
on public.questions for delete
to authenticated
using (public.is_admin());

create policy "Anyone inserts results"
on public.results for insert
to anon, authenticated
with check (
  char_length(participant_name) between 2 and 80
  and score between 0 and 100
  and question_count between 1 and 500
  and correct_count + wrong_count = question_count
);

create policy "Admins read results"
on public.results for select
to authenticated
using (public.is_admin());

create policy "Admins delete results"
on public.results for delete
to authenticated
using (public.is_admin());

-- أقل الصلاحيات اللازمة
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.categories from anon, authenticated;
revoke all on table public.questions from anon, authenticated;
revoke all on table public.results from anon, authenticated;

grant select on table public.admin_users to authenticated;
grant select on table public.categories to anon, authenticated;
grant insert, update, delete on table public.categories to authenticated;
grant select on table public.questions to anon, authenticated;
grant insert, update, delete on table public.questions to authenticated;
grant insert on table public.results to anon, authenticated;
grant select, delete on table public.results to authenticated;

-- الأقسام الأساسية. يمكن تعديلها لاحقًا من لوحة المدير.
insert into public.categories (slug, name, description, icon, sort_order)
values
  ('rpg', 'القاذف RPG', 'قسم مخصص لأسئلة القاذف التي يضيفها المدير.', '🎯', 10),
  ('ak47', 'البندقية AK-47', 'قسم مخصص لأسئلة البندقية التي يضيفها المدير.', '📘', 20),
  ('pkc', 'الرشاش PKC', 'قسم مخصص لأسئلة الرشاش التي يضيفها المدير.', '📗', 30),
  ('compass', 'البوصلة', 'الأقسام والاستخدامات الأساسية.', '🧭', 40),
  ('protective-mask', 'القناع الواقي', 'الغرض والأقسام العامة وإشارات الخطر.', '😷', 50),
  ('topography', 'الطبوغرافية', 'طرق التوجه التقريبية والدقيقة.', '🗺️', 60),
  ('readiness', 'الجاهزية القتالية', 'التعريف والحالات العامة.', '🛡️', 70),
  ('grenades', 'القنابل', 'قسم مخصص للأسئلة التي يضيفها المدير.', '📙', 80)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order;

-- نماذج تعليمية آمنة لتجربة النظام. يمنع تكرارها عند إعادة التشغيل.
insert into public.questions (category_id, type, difficulty, prompt, options, accepted_answers, explanation)
select c.id, 'mcq', 'easy',
  'أي جزء في البوصلة يتحرك وفق المجال المغناطيسي للأرض؟',
  '["الإبرة المغناطيسية","المسطرة","الحمالة","المرآة"]'::jsonb,
  '["الإبرة المغناطيسية"]'::jsonb,
  'الإبرة المغناطيسية تساعد على تحديد اتجاه الشمال.'
from public.categories c
where c.slug = 'compass'
and not exists (select 1 from public.questions where prompt = 'أي جزء في البوصلة يتحرك وفق المجال المغناطيسي للأرض؟');

insert into public.questions (category_id, type, difficulty, prompt, options, accepted_answers, explanation)
select c.id, 'true_false', 'easy',
  'من استخدامات البوصلة تحديد الشمال وتوجيه الخريطة.',
  '["صح","خطأ"]'::jsonb,
  '["صح"]'::jsonb,
  'العبارة صحيحة.'
from public.categories c
where c.slug = 'compass'
and not exists (select 1 from public.questions where prompt = 'من استخدامات البوصلة تحديد الشمال وتوجيه الخريطة.');

insert into public.questions (category_id, type, difficulty, prompt, options, accepted_answers, explanation)
select c.id, 'mcq', 'easy',
  'ما الغرض العام من القناع الواقي؟',
  '["حماية الوجه والعينين والجهاز التنفسي من الملوثات الضارة","تحسين الرؤية الليلية","قياس المسافات","توجيه الخريطة"]'::jsonb,
  '["حماية الوجه والعينين والجهاز التنفسي من الملوثات الضارة"]'::jsonb,
  'الغرض الأساسي هو تقليل التعرض للملوثات الخطرة.'
from public.categories c
where c.slug = 'protective-mask'
and not exists (select 1 from public.questions where prompt = 'ما الغرض العام من القناع الواقي؟');

insert into public.questions (category_id, type, difficulty, prompt, options, accepted_answers, explanation)
select c.id, 'mcq', 'easy',
  'أي مما يلي يُعد طريقة دقيقة للتوجه؟',
  '["البوصلة","سؤال السكان","مراقبة الشمس فقط","مراقبة شكل المقابر"]'::jsonb,
  '["البوصلة"]'::jsonb,
  'البوصلة والخريطة من الوسائل الدقيقة مقارنة بالدلائل التقريبية.'
from public.categories c
where c.slug = 'topography'
and not exists (select 1 from public.questions where prompt = 'أي مما يلي يُعد طريقة دقيقة للتوجه؟');

insert into public.questions (category_id, type, difficulty, prompt, options, accepted_answers, explanation)
select c.id, 'fill', 'easy',
  'أكمل: من طرق التوجه الدقيقة التوجه بواسطة البوصلة وبواسطة ______.',
  '[]'::jsonb,
  '["الخريطة","الخرائط"]'::jsonb,
  'الإجابة المقبولة: الخريطة أو الخرائط.'
from public.categories c
where c.slug = 'topography'
and not exists (select 1 from public.questions where prompt = 'أكمل: من طرق التوجه الدقيقة التوجه بواسطة البوصلة وبواسطة ______.');

insert into public.questions (category_id, type, difficulty, prompt, options, accepted_answers, explanation)
select c.id, 'mcq', 'medium',
  'ما المعنى العام للجاهزية؟',
  '["القدرة على البدء بالمهمة في الوقت المحدد وباستعداد كامل","زيادة عدد الأسئلة","حفظ الخريطة فقط","تبديل المظهر"]'::jsonb,
  '["القدرة على البدء بالمهمة في الوقت المحدد وباستعداد كامل"]'::jsonb,
  'الجاهزية تعبّر عن القدرة على البدء بالمهمة في الوقت المحدد وبالاستعداد المطلوب.'
from public.categories c
where c.slug = 'readiness'
and not exists (select 1 from public.questions where prompt = 'ما المعنى العام للجاهزية؟');

-- ============================================================
-- بعد إنشاء مستخدم المدير في Authentication > Users، نفّذ السطر التالي
-- بعد استبدال UUID بمعرّف المستخدم الحقيقي:
--
-- insert into public.admin_users (user_id, display_name)
-- values ('PUT-AUTH-USER-UUID-HERE', 'محمود عبد المعطي الأحمد');
-- ============================================================
