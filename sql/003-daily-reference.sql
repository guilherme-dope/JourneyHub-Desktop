SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'journey.DailyReference', N'U') IS NULL
BEGIN
  CREATE TABLE journey.DailyReference (
    EffectiveDate date PRIMARY KEY,
    Minutes int NOT NULL CHECK (Minutes BETWEEN 1 AND 1440)
  );
END;
GRANT SELECT, INSERT, UPDATE ON journey.DailyReference TO journey_app;
COMMIT;
