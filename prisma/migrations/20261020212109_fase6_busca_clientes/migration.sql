-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "zipCode" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "consentAt" DATETIME,
    "anonymizedAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("active", "anonymizedAt", "city", "complement", "consentAt", "createdAt", "deletedAt", "district", "document", "email", "id", "name", "notes", "number", "phone", "state", "street", "updatedAt", "zipCode") SELECT "active", "anonymizedAt", "city", "complement", "consentAt", "createdAt", "deletedAt", "district", "document", "email", "id", "name", "notes", "number", "phone", "state", "street", "updatedAt", "zipCode" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_name_idx" ON "Customer"("name");
CREATE INDEX "Customer_document_idx" ON "Customer"("document");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
