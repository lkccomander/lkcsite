\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.strategy_performance') IS NULL THEN
        RAISE EXCEPTION 'public.strategy_performance does not exist';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.strategy_performance
        WHERE session_id IS NOT NULL
        GROUP BY session_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate non-null strategy_performance.session_id values exist';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS strategy_performance_session_id_unique
ON public.strategy_performance (session_id)
WHERE session_id IS NOT NULL;
