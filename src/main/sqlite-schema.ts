export const sqliteSchema = `
  CREATE TABLE WorkSessions (
    Id TEXT PRIMARY KEY, WorkDate TEXT NOT NULL, StartedAt TEXT NOT NULL,
    EndedAt TEXT, Notes TEXT NOT NULL, Version INTEGER NOT NULL CHECK(Version > 0),
    DeletedAt TEXT, Singleton INTEGER NOT NULL DEFAULT 1 CHECK(Singleton = 1),
    CHECK(EndedAt IS NULL OR EndedAt > StartedAt)
  ) STRICT;
  CREATE UNIQUE INDEX UX_WorkDate ON WorkSessions(WorkDate) WHERE DeletedAt IS NULL;
  CREATE UNIQUE INDEX UX_OneOpen ON WorkSessions(Singleton) WHERE EndedAt IS NULL AND DeletedAt IS NULL;
  CREATE TABLE Breaks (
    Id TEXT PRIMARY KEY, SessionId TEXT NOT NULL REFERENCES WorkSessions(Id),
    Position INTEGER NOT NULL CHECK(Position >= 0), StartedAt TEXT NOT NULL,
    EndedAt TEXT, Reason TEXT NOT NULL CHECK(length(trim(Reason)) > 0),
    UNIQUE(SessionId, Position), CHECK(EndedAt IS NULL OR EndedAt > StartedAt)
  ) STRICT;
  CREATE UNIQUE INDEX UX_OneOpenBreak ON Breaks(SessionId) WHERE EndedAt IS NULL;
  CREATE TABLE AuditLog (
    Id TEXT PRIMARY KEY, SessionId TEXT NOT NULL REFERENCES WorkSessions(Id),
    Action TEXT NOT NULL, Reason TEXT NOT NULL, Actor TEXT NOT NULL,
    RecordedAt TEXT NOT NULL, BeforeJson TEXT CHECK(BeforeJson IS NULL OR json_valid(BeforeJson)),
    AfterJson TEXT NOT NULL CHECK(json_valid(AfterJson))
  ) STRICT;
  CREATE INDEX IX_Audit_Session ON AuditLog(SessionId, RecordedAt);
  CREATE TRIGGER AuditNoUpdate BEFORE UPDATE ON AuditLog BEGIN SELECT RAISE(ABORT, 'Immutable audit'); END;
  CREATE TRIGGER AuditNoDelete BEFORE DELETE ON AuditLog BEGIN SELECT RAISE(ABORT, 'Immutable audit'); END;
  CREATE TRIGGER SessionNoDelete BEFORE DELETE ON WorkSessions BEGIN SELECT RAISE(ABORT, 'Use trash'); END;
  PRAGMA user_version=1;
`;

export const referenceSchema = `CREATE TABLE IF NOT EXISTS DailyReference (
  EffectiveDate TEXT PRIMARY KEY, Minutes INTEGER NOT NULL CHECK(Minutes BETWEEN 1 AND 1440)
) STRICT;`;
