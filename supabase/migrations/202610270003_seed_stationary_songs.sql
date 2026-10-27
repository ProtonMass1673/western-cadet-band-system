insert into public.notation (id, name, category, url, updated)
values
  ('55000000-0000-4000-8000-000000000001', '🔴 National Anthem', 'Stationary Songs', 'https://drive.google.com/file/d/1cfeXYBrb2OWcfD1KHRuWD9vBcGK-JVaL/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000002', '🔴 NCC', 'Stationary Songs', 'https://drive.google.com/drive/folders/1UYIwVkrszxlKBYOw7i9RJQtbx91LPmU4?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000003', '🔴 Parade Card', 'Stationary Songs', 'https://drive.google.com/file/d/1JU2QboaiZN9Kegvk3Lw4haYz_iWX2Jbb/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000004', 'Army Of The Nile', 'Songs', 'https://drive.google.com/file/d/15-eec8JCpq0M2utzxOWAwVOtVzOKElSH/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000005', 'Colonel Bogey', 'Songs', 'https://drive.google.com/file/d/1VEkYQbKOrb78-qn-vyAqV-qTBSoRLnaY/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000006', 'Rathna Deepa', 'Songs', 'https://drive.google.com/file/d/1LpiLrXIkf7rETQt89d3ZPvOMvUpPjtjD/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000007', 'Suwada Rosa Mal Nela', 'Songs', 'https://drive.google.com/file/d/1EhZkTOpGNoZV7n98KhfBITc6DGvDXp7w/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000008', 'Duvillen Wthsunu Thawara', 'Songs', 'https://drive.google.com/file/d/1psv8OBAo17aJosJK1iQvd7uDmKTWDycr/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000009', 'ST Georg', 'Group A', 'https://drive.google.com/file/d/1iywOnph7I-07Dz4x_KojBs1DS7YoNDHt/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000010', 'Hela jathila', 'Group A', 'https://drive.google.com/file/d/18aOYrE-TOY8Y7oQEIPLa0vuM3LM5NWOm/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000011', 'AIDA', 'Group A', 'https://drive.google.com/file/d/1X7BY9mt4u_DnQUie5FVNPIaG9omyMEcA/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000012', 'Ranabima Marune', 'Group A', 'https://drive.google.com/file/d/1ZohpavJ0Wi7rbTzHd0Zbd0mD_81hFqag/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000013', 'Voice Of The Guns', 'Group B', 'https://drive.google.com/file/d/1Ta81ROhjo50Ax5qVRewrpp0FQioaWtoq/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000014', 'Ranabime Viruwo', 'Group B', 'https://drive.google.com/file/d/17h4jEz071VZR4bEcbV6BMeUSic3jvMQF/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000015', 'SCIPIO', 'Group B', 'https://drive.google.com/file/d/1RqF4OPHGNTd6nmb-xA0QT4nDGFShT_R7/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000016', 'News', 'Group C', 'https://drive.google.com/file/d/1wArmcusOTMkMLc_atbtT05FWkM1p6Prt/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000017', 'Nelson Touch', 'Group C', 'https://drive.google.com/file/d/1wJHVD_Tt0ePCeGfo3oMUfn6Q2Ke3_aa6/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000018', 'By Land And Sea', 'Group C', 'https://drive.google.com/file/d/1-TD9haK5b7GDRhpwmWgKUUrv7pRatjxF/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000019', 'Mura Dewwara Sena', 'Group C', 'https://drive.google.com/file/d/1wqKz0mWIxTfVTzotrAwEihSe-xsZNUDW/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000020', 'Lanka Lanka', 'Group D', 'https://drive.google.com/file/d/1D1wsFaznyYwFTgiNZ82b10_nXUq1J9mB/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000021', 'The Duke Of York', 'Group D', 'https://drive.google.com/file/d/1CCpceGL5Ry7dbEW3OnKiRtwGQRaCdcVO/view?usp=drive_link', current_date),
  ('55000000-0000-4000-8000-000000000022', 'Thunderer', 'Group D', 'https://drive.google.com/file/d/1hDaV-UElpmO_byoDLPMUNPhNmxf9Qs9R/view?usp=drive_link', current_date)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  url = excluded.url,
  updated = excluded.updated;

