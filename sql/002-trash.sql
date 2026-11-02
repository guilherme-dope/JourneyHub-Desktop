SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (SELECT 1 FROM journey.SchemaVersions WHERE Version=2)
BEGIN
  ALTER TABLE journey.WorkSessions ADD DeletedAt datetime2(0) NULL;
  DROP INDEX UX_WorkDate ON journey.WorkSessions;
  DROP INDEX UX_OneOpen ON journey.WorkSessions;
  EXEC(N'CREATE UNIQUE INDEX UX_WorkDate ON journey.WorkSessions(WorkDate) WHERE DeletedAt IS NULL');
  EXEC(N'CREATE UNIQUE INDEX UX_OneOpen ON journey.WorkSessions(Singleton) WHERE EndedAt IS NULL AND DeletedAt IS NULL');
  INSERT journey.SchemaVersions(Version) VALUES(2);
END;
COMMIT;
