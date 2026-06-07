-- Run this once you have confirmed that strategy_configs (plural) is in use
-- and no old clients depend on the single-row strategy_config (singular) table.
--
-- All engine configuration now lives in strategy_configs.
-- The legacy /strategy/config endpoints in strategy_routes.py have been removed.

DROP TABLE IF EXISTS strategy_config;
