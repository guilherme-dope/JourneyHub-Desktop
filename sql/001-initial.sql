SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF SCHEMA_ID(N'journey') IS NULL EXEC(N'CREATE SCHEMA journey AUTHORIZATION dbo');
IF OBJECT_ID(N'journey.SchemaVersions') IS NULL
  CREATE TABLE journey.SchemaVersions (Version int NOT NULL PRIMARY KEY, AppliedAt datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM journey.SchemaVersions WHERE Version=1)
BEGIN
  CREATE TABLE journey.WorkSessions (
    Id uniqueidentifier NOT NULL PRIMARY KEY,
    WorkDate date NOT NULL,
    StartedAt datetime2(0) NOT NULL,
    EndedAt datetime2(0) NULL,
    Notes nvarchar(2000) NOT NULL DEFAULT N'',
    Version int NOT NULL,
    Singleton tinyint NOT NULL DEFAULT 1,
    CONSTRAINT CK_Session_Time CHECK (EndedAt IS NULL OR EndedAt > StartedAt),
    CONSTRAINT CK_Session_Version CHECK (Version > 0),
    CONSTRAINT CK_Session_Singleton CHECK (Singleton = 1)
  );
  CREATE UNIQUE INDEX UX_WorkDate ON journey.WorkSessions(WorkDate);
  CREATE UNIQUE INDEX UX_OneOpen ON journey.WorkSessions(Singleton) WHERE EndedAt IS NULL;
  CREATE INDEX IX_Session_Time ON journey.WorkSessions(StartedAt, EndedAt);
  CREATE TABLE journey.Breaks (
    Id uniqueidentifier NOT NULL PRIMARY KEY,
    SessionId uniqueidentifier NOT NULL REFERENCES journey.WorkSessions(Id),
    Position int NOT NULL,
    StartedAt datetime2(0) NOT NULL,
    EndedAt datetime2(0) NULL,
    Reason nvarchar(300) NOT NULL,
    CONSTRAINT CK_Break_Time CHECK (EndedAt IS NULL OR EndedAt > StartedAt),
    CONSTRAINT CK_Break_Reason CHECK (LEN(LTRIM(RTRIM(Reason))) > 0),
    CONSTRAINT CK_Break_Position CHECK (Position >= 0),
    CONSTRAINT UQ_Break_Position UNIQUE (SessionId, Position)
  );
  CREATE UNIQUE INDEX UX_OneOpenBreak ON journey.Breaks(SessionId) WHERE EndedAt IS NULL;
  CREATE TABLE journey.AuditLog (
    Id uniqueidentifier NOT NULL PRIMARY KEY,
    SessionId uniqueidentifier NOT NULL REFERENCES journey.WorkSessions(Id),
    Action nvarchar(20) NOT NULL,
    Reason nvarchar(500) NOT NULL,
    Actor nvarchar(256) NOT NULL,
    RecordedAt datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
    BeforeJson nvarchar(max) NULL,
    AfterJson nvarchar(max) NOT NULL,
    CONSTRAINT CK_Audit_Json CHECK ((BeforeJson IS NULL OR ISJSON(BeforeJson)=1) AND ISJSON(AfterJson)=1)
  );
  CREATE INDEX IX_Audit_Session ON journey.AuditLog(SessionId, RecordedAt);
  INSERT journey.SchemaVersions(Version) VALUES (1);
END;
IF DATABASE_PRINCIPAL_ID(N'journey_app') IS NULL CREATE ROLE journey_app AUTHORIZATION dbo;
GRANT SELECT ON journey.SchemaVersions TO journey_app;
GRANT SELECT, INSERT, UPDATE ON journey.WorkSessions TO journey_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON journey.Breaks TO journey_app;
GRANT SELECT, INSERT ON journey.AuditLog TO journey_app;
DENY UPDATE, DELETE ON journey.AuditLog TO journey_app;
DENY DELETE ON journey.WorkSessions TO journey_app;
COMMIT;
