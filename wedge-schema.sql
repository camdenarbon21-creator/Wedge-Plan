-- WEDGE//PLAN — Supabase schema
-- Design notes:
--   * Every shot is kept forever. The rolling-50 window is a QUERY, not a delete.
--     That way you keep season-over-season history but still read recent form.
--   * ball_type and surface are the two biggest artifacts in launch monitor data.
--     Range rock vs gamer is worth a yard of dispersion; mats hide fat strikes.
--     Log them from day one or you can't filter later.
--   * grip_choke_in is there for when the choked-down sub-50yd shots get added.

create table if not exists shots (
  id            bigserial primary key,
  club          text not null check (club in ('60','55','50','46')),
  feel          text not null check (feel in ('knee','hip','three_quarter','chest')),
  carry         numeric(5,1) not null,
  grip_choke_in numeric(3,1) default 0,
  ball_type     text,                    -- 'range' | 'gamer' | brand
  surface       text,                    -- 'mat' | 'grass'
  temp_f        int,                     -- carry moves with temp; worth capturing
  notes         text,
  hit_on        date not null default current_date,
  created_at    timestamptz default now()
);

create index if not exists shots_stock_idx on shots (club, feel, hit_on desc);

-- Lag putting: 10 putts per set, count finishing inside the 10%-each-side zone
create table if not exists lag_sessions (
  id          bigserial primary key,
  distance_ft int not null,
  in_zone     int not null check (in_zone between 0 and 10),
  of_putts    int not null default 10,
  logged_on   date not null default current_date
);

-- Free-text session log per practice day
create table if not exists session_notes (
  id         bigserial primary key,
  logged_on  date not null,
  body       text not null
);

-- ── Rolling 50 per stock ───────────────────────────────────────────────
-- Average, standard deviation and range over the most recent 50 shots.
-- SD is the number that actually matters; max-min grows with sample size.
create or replace view stock_rolling_50 as
with ranked as (
  select *, row_number() over (partition by club, feel order by hit_on desc, id desc) as rn
  from shots
)
select
  club,
  feel,
  count(*)                                   as n,
  round(avg(carry), 1)                       as avg_carry,
  round(stddev_samp(carry), 2)               as sd,
  round(100 * stddev_samp(carry) / avg(carry), 2) as sd_pct_of_carry,
  max(carry) - min(carry)                    as range_yds,
  min(hit_on)                                as window_from,
  max(hit_on)                                as window_to
from ranked
where rn <= 50
group by club, feel
order by avg_carry;

-- ── Gap finder ─────────────────────────────────────────────────────────
-- Anything over 9 yards between consecutive stocks is a hole in coverage.
create or replace view stock_gaps as
with ordered as (
  select club, feel, avg_carry,
         lag(avg_carry) over (order by avg_carry)  as prev_carry,
         lag(club)      over (order by avg_carry)  as prev_club,
         lag(feel)      over (order by avg_carry)  as prev_feel
  from stock_rolling_50
)
select prev_club, prev_feel, prev_carry, club, feel, avg_carry,
       round(avg_carry - prev_carry, 1) as gap_yds
from ordered
where prev_carry is not null
  and avg_carry - prev_carry > 9
order by avg_carry;
