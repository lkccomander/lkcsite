\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.strategy_performance
        WHERE id = 'e782c16a-f4b0-4222-824e-3380f664d8ed'::uuid
          AND session_id IS NULL
          AND final_balance IS NULL
          AND finish_timestamp IS NULL
    ) THEN
        RAISE EXCEPTION 'LIVE target row is not in the expected incomplete state';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.strategy_performance
        WHERE id = '09039abf-cd45-4e1a-b128-03d92587cee5'::uuid
          AND session_id IS NULL
          AND final_balance IS NULL
          AND finish_timestamp IS NULL
    ) THEN
        RAISE EXCEPTION 'PAPER target row is not in the expected incomplete state';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.strategy_performance
        WHERE session_id IN (
            'bea7bec8-a30e-445b-8239-ebd17b215e24',
            '48423b4d-a29e-4647-a24f-925a3fc1145a'
        )
    ) THEN
        RAISE EXCEPTION 'one of the repair session IDs is already linked';
    END IF;
END $$;

UPDATE public.strategy_performance
SET session_id = 'bea7bec8-a30e-445b-8239-ebd17b215e24',
    session_type = 'LIVE_TRADING',
    initial_balance = 712.671433,
    final_balance = 712.671433,
    strat_timestamp = '2026-07-16T22:01:09.041Z'::timestamptz,
    finish_timestamp = '2026-07-16T22:14:47.999Z'::timestamptz
WHERE id = 'e782c16a-f4b0-4222-824e-3380f664d8ed'::uuid;

UPDATE public.strategy_performance
SET session_id = '48423b4d-a29e-4647-a24f-925a3fc1145a',
    session_type = 'PAPER_TESTING',
    initial_balance = 210.48,
    final_balance = 209.65,
    strat_timestamp = '2026-07-16T22:19:13.685Z'::timestamptz,
    finish_timestamp = '2026-07-16T22:46:19.403Z'::timestamptz
WHERE id = '09039abf-cd45-4e1a-b128-03d92587cee5'::uuid;

DO $$
BEGIN
    IF (
        SELECT count(*)
        FROM public.strategy_performance
        WHERE session_id IN (
            'bea7bec8-a30e-445b-8239-ebd17b215e24',
            '48423b4d-a29e-4647-a24f-925a3fc1145a'
        )
    ) <> 2 THEN
        RAISE EXCEPTION 'repair verification did not find exactly two rows';
    END IF;
END $$;
