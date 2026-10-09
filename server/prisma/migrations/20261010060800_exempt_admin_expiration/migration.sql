UPDATE "Users"
SET "expiration_date" = NULL
WHERE LOWER(BTRIM("role")) = 'admin';
