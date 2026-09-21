DROP TABLE IF EXISTS island_daily_actions;
DROP TABLE IF EXISTS island_events;
DROP TABLE IF EXISTS island_placements;
DROP TABLE IF EXISTS island_inventory;
DROP TABLE IF EXISTS island_pets;
DROP TABLE IF EXISTS islands;

DELETE FROM ai_runs WHERE plugin_id = 'island-avatar';
