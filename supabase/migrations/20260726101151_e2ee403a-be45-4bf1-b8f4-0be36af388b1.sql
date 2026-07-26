
DO $$
DECLARE
  retainer_id uuid;
  corp_id uuid;
  ins_id uuid;
  pid uuid;
  vid uuid;
  invid uuid;
  first_names text[] := ARRAY['Aisha','Musa','Fatima','Ibrahim','Zainab','Umar','Halima','Sani','Amina','Yusuf'];
  last_names text[] := ARRAY['Bello','Abubakar','Sule','Danjuma','Garba','Idris','Kabir','Lawal','Salihu','Tanko'];
  i int;
  amt numeric;
  when_ts timestamptz;
BEGIN
  SELECT id INTO retainer_id FROM corporate_accounts WHERE account_type='retainer' LIMIT 1;

  SELECT id INTO corp_id FROM corporate_accounts WHERE company_name='Dangote Group' LIMIT 1;
  IF corp_id IS NULL THEN
    INSERT INTO corporate_accounts (company_name, phone, address, account_type, sponsor_type, status)
    VALUES ('Dangote Group', '08012340000', 'Dangote HQ, Kano', 'corporate', 'corporate', 'active')
    RETURNING id INTO corp_id;
  END IF;

  SELECT id INTO ins_id FROM insurance_providers WHERE name='NHIA' LIMIT 1;
  IF ins_id IS NULL THEN
    INSERT INTO insurance_providers (name, type, code, coverage_percentage, status)
    VALUES ('NHIA', 'nhia', 'NHIA-001', 90, 'active')
    RETURNING id INTO ins_id;
  END IF;

  FOR i IN 1..10 LOOP
    -- Retainer patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, corporate_id, card_number, mini_card_number, status)
    VALUES (first_names[i], last_names[i], CASE WHEN i%2=0 THEN 'male' ELSE 'female' END,
            '0803000' || lpad(i::text,4,'0'), 'Kano', '1990-01-01', 'retainer', retainer_id, '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '10 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, corporate_id, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'retainer', retainer_id, when_ts, 'Routine consultation', 'pending')
    RETURNING id INTO vid;
    amt := 5000 + (i*500);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, corporate_account_id, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'retainer', retainer_id, 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 2000, 2000, 'consultation'),
      (invid, 'Malaria RDT', 1, 1500, 1500, 'lab'),
      (invid, 'Drugs', 1, amt-3500, amt-3500, 'pharmacy');

    -- Corporate patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, corporate_id, card_number, mini_card_number, status)
    VALUES (first_names[i], last_names[((i+3)%10)+1], CASE WHEN i%2=0 THEN 'female' ELSE 'male' END,
            '0804000' || lpad(i::text,4,'0'), 'Kano', '1988-05-15', 'corporate', corp_id, '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '11 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, corporate_id, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'corporate', corp_id, when_ts, 'Company medical', 'pending')
    RETURNING id INTO vid;
    amt := 7500 + (i*750);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, corporate_account_id, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'corporate', corp_id, 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 3000, 3000, 'consultation'),
      (invid, 'Chest X-Ray', 1, 4500, 4500, 'lab'),
      (invid, 'Drugs', 1, amt-7500, amt-7500, 'pharmacy');

    -- Insurance patient
    INSERT INTO patients (first_name, last_name, gender, phone, address, date_of_birth, account_type, insurance_provider, insurance_policy_number, card_number, mini_card_number, status)
    VALUES (first_names[((i+5)%10)+1], last_names[i], CASE WHEN i%2=0 THEN 'male' ELSE 'female' END,
            '0805000' || lpad(i::text,4,'0'), 'Kano', '1985-08-20', 'insurance', 'NHIA', 'NHIA-POL-' || lpad(i::text,4,'0'), '', '', 'discharged')
    RETURNING id INTO pid;
    when_ts := date_trunc('month', now()) + ((i-1) || ' days')::interval + interval '12 hours';
    INSERT INTO visits (patient_id, visit_number, status, sponsor_type, opened_at, presenting_complaint, claim_status)
    VALUES (pid, next_visit_number(), 'settled', 'insurance', when_ts, 'Insurance visit', 'pending')
    RETURNING id INTO vid;
    amt := 6000 + (i*600);
    INSERT INTO invoices (patient_id, visit_id, invoice_number, total_amount, original_amount, sponsor_type, status, created_at, updated_at)
    VALUES (pid, vid, '', amt, amt, 'insurance', 'pending', when_ts, when_ts)
    RETURNING id INTO invid;
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, category) VALUES
      (invid, 'Consultation', 1, 2500, 2500, 'consultation'),
      (invid, 'Blood test', 1, 2000, 2000, 'lab'),
      (invid, 'Drugs', 1, amt-4500, amt-4500, 'pharmacy');
  END LOOP;
END $$;
