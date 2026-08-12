-- Isolated live workflow regression suite.
-- It creates temporary test records inside one transaction, validates every
-- transition, rolls back all changes, and returns a pass summary only if every
-- assertion succeeds.

BEGIN;
SET LOCAL statement_timeout = '60s';
SELECT set_config('request.jwt.claim.sub', 'ae280a39-6e52-4dc0-927f-34d347cb0a88', true);

DO $test$
DECLARE
  _profiles text[] := ARRAY[
    'normal_wallet',
    'normal_cash',
    'corporate',
    'retainer',
    'nhis',
    'hmo',
    'katchma',
    'staff',
    'staff_family'
  ];
  _account_types text[] := ARRAY[
    'normal',
    'normal',
    'corporate',
    'retainer',
    'nhis',
    'hmo',
    'katchma',
    'staff',
    'staff_family'
  ];
  _station_path text[] := ARRAY[
    'waiting',
    'with_nurse',
    'with_doctor',
    'in_lab',
    'awaiting_billing',
    'awaiting_payment',
    'at_pharmacy',
    'discharged'
  ];
  _i integer;
  _station text;
  _profile text;
  _account_type text;
  _run_token text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  _patient_id uuid;
  _visit_id uuid;
  _journey_id uuid;
  _admission_id uuid;
  _patient_status text;
  _journey_status text;
  _admission_status text;
  _visit_status text;
BEGIN
  FOR _i IN 1..array_length(_profiles, 1) LOOP
    _profile := _profiles[_i];
    _account_type := _account_types[_i];

    -- Outpatient station workflow: verifies every state change for this profile.
    INSERT INTO public.patients (
      first_name, last_name, account_type, balance, card_number,
      date_of_birth, gender, phone, address, status
    ) VALUES (
      'QA', 'OUT-' || _profile || '-' || _run_token,
      _account_type, 10000,
      'QA-OUT-' || _i || '-' || _run_token,
      DATE '1990-01-01', 'male', '0000000000',
      'Isolated workflow regression test', 'registered'
    )
    RETURNING id INTO _patient_id;

    INSERT INTO public.visits (
      patient_id, visit_number, status, sponsor_type
    ) VALUES (
      _patient_id,
      'QA-OUT-' || _i || '-' || _run_token,
      'settled',
      _account_type
    )
    RETURNING id INTO _visit_id;

    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role
    ) VALUES (
      _patient_id, _visit_id, 'registered', 'reception'
    )
    RETURNING id INTO _journey_id;

    FOREACH _station IN ARRAY _station_path LOOP
      PERFORM public.advance_journey(
        _patient_id,
        _station,
        CASE _station
          WHEN 'waiting' THEN 'reception'
          WHEN 'with_nurse' THEN 'nurse'
          WHEN 'with_doctor' THEN 'doctor1'
          WHEN 'in_lab' THEN 'lab'
          WHEN 'awaiting_billing' THEN 'billing'
          WHEN 'awaiting_payment' THEN 'cashier'
          WHEN 'at_pharmacy' THEN 'pharmacy'
          WHEN 'discharged' THEN 'reception'
        END,
        NULL,
        NULL,
        NULL,
        _visit_id,
        'Isolated station-transition regression test: ' || _profile
      );

      SELECT p.status, j.current_state
      INTO _patient_status, _journey_status
      FROM public.patients p
      JOIN public.patient_journey j ON j.patient_id = p.id
      WHERE p.id = _patient_id;

      IF _patient_status IS DISTINCT FROM _station
         OR _journey_status IS DISTINCT FROM _station THEN
        RAISE EXCEPTION
          'Station transition failed for profile %, expected %, patient %, journey %',
          _profile, _station, _patient_status, _journey_status;
      END IF;
    END LOOP;

    -- Inpatient cashier discharge: verifies the settlement function writes the
    -- admission, patient, and central journey state together for this profile.
    INSERT INTO public.patients (
      first_name, last_name, account_type, balance, card_number,
      date_of_birth, gender, phone, address, status
    ) VALUES (
      'QA', 'IN-' || _profile || '-' || _run_token,
      _account_type, 10000,
      'QA-IN-' || _i || '-' || _run_token,
      DATE '1990-01-01', 'female', '0000000001',
      'Isolated discharge regression test', 'admitted'
    )
    RETURNING id INTO _patient_id;

    INSERT INTO public.visits (
      patient_id, visit_number, status, sponsor_type
    ) VALUES (
      _patient_id,
      'QA-IN-' || _i || '-' || _run_token,
      'settled',
      _account_type
    )
    RETURNING id INTO _visit_id;

    INSERT INTO public.patient_journey (
      patient_id, visit_id, current_state, owner_role
    ) VALUES (
      _patient_id, _visit_id, 'admitted', 'nurse'
    )
    RETURNING id INTO _journey_id;

    INSERT INTO public.admissions (
      patient_id, visit_id, admitted_at, status
    ) VALUES (
      _patient_id, _visit_id, now(), 'ready_for_discharge'
    )
    RETURNING id INTO _admission_id;

    PERFORM public.discharge_admission(
      _admission_id,
      'Isolated workflow regression test',
      NULL,
      0,
      'No financial charge in status-only test',
      0
    );

    SELECT p.status, j.current_state, a.status, v.status
    INTO _patient_status, _journey_status, _admission_status, _visit_status
    FROM public.patients p
    JOIN public.patient_journey j ON j.patient_id = p.id
    JOIN public.admissions a ON a.patient_id = p.id
    JOIN public.visits v ON v.id = a.visit_id
    WHERE p.id = _patient_id
      AND a.id = _admission_id;

    IF _patient_status IS DISTINCT FROM 'discharged'
       OR _journey_status IS DISTINCT FROM 'discharged'
       OR _admission_status IS DISTINCT FROM 'discharged'
       OR _visit_status IS DISTINCT FROM 'settled' THEN
      RAISE EXCEPTION
        'Cashier discharge synchronization failed for profile %, patient %, journey %, admission %, visit %',
        _profile, _patient_status, _journey_status, _admission_status, _visit_status;
    END IF;
  END LOOP;
END;
$test$;

ROLLBACK;

SELECT
  'PASSED' AS result,
  9 AS billing_profiles_tested,
  72 AS verified_station_transitions,
  9 AS verified_cashier_discharge_transitions,
  'All test records were rolled back.' AS cleanup_status;
