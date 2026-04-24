\connect travel

insert into public.milestone_kinds (kind, direction, order_seq, label, shown_when_carry_on) values
  ('dep_in_transit',      'departure', 1, 'In Transit',        true),
  ('dep_at_airport',      'departure', 2, 'At Airport',        true),
  ('dep_bags',            'departure', 3, 'Dropped Bags',      false),
  ('dep_security',        'departure', 4, 'Through Security',  true),
  ('arr_off_plane',       'arrival',   1, 'Off the Plane',     true),
  ('arr_bags',            'arrival',   2, 'Collected Bags',    false),
  ('arr_in_transit',      'arrival',   3, 'In Transit',        true),
  ('arr_at_destination',  'arrival',   4, 'At Destination',    true)
on conflict (kind) do nothing;
