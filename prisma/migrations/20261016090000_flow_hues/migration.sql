-- The redesign's ten person hues (DESIGN-PLAN 1.1). Each old colour name moves
-- to its nearest new hue. One CASE per table, so no row is renamed twice
-- ("violet" is both an old name and a new one).
UPDATE "Person" SET "avatarColor" = CASE "avatarColor"
  WHEN 'iris' THEN 'violet'
  WHEN 'violet' THEN 'plum'
  WHEN 'fuchsia' THEN 'orchid'
  WHEN 'rose' THEN 'coral'
  WHEN 'orange' THEN 'sand'
  WHEN 'lime' THEN 'olive'
  WHEN 'cyan' THEN 'azure'
  WHEN 'sky' THEN 'cobalt'
  ELSE "avatarColor"
END;

UPDATE "Group" SET "color" = CASE "color"
  WHEN 'iris' THEN 'violet'
  WHEN 'violet' THEN 'plum'
  WHEN 'fuchsia' THEN 'orchid'
  WHEN 'rose' THEN 'coral'
  WHEN 'orange' THEN 'sand'
  WHEN 'lime' THEN 'olive'
  WHEN 'cyan' THEN 'azure'
  WHEN 'sky' THEN 'cobalt'
  ELSE "color"
END;
