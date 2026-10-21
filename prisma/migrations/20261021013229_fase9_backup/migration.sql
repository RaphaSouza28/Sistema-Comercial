-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BackupRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "path" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "message" TEXT,
    "userId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackupRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BackupRecord" ("checksum", "createdAt", "id", "kind", "path", "sizeBytes", "userId") SELECT "checksum", "createdAt", "id", "kind", "path", "sizeBytes", "userId" FROM "BackupRecord";
DROP TABLE "BackupRecord";
ALTER TABLE "new_BackupRecord" RENAME TO "BackupRecord";
CREATE INDEX "BackupRecord_createdAt_idx" ON "BackupRecord"("createdAt");
CREATE INDEX "BackupRecord_kind_status_idx" ON "BackupRecord"("kind", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
