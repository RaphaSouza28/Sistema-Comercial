-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "authorizationCode" TEXT;
ALTER TABLE "Payment" ADD COLUMN "cardBrand" TEXT;
ALTER TABLE "Payment" ADD COLUMN "nsu" TEXT;
ALTER TABLE "Payment" ADD COLUMN "reconciledAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "reconciledById" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "taxCode" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FiscalDocument" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "saleId" INTEGER,
    "provider" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
    "number" INTEGER,
    "series" INTEGER,
    "accessKey" TEXT,
    "protocol" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "xmlPath" TEXT,
    "danfePath" TEXT,
    "payload" TEXT,
    "issues" TEXT,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "requestedById" INTEGER,
    "authorizedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FiscalDocument_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FiscalDocument" ("accessKey", "createdAt", "danfePath", "environment", "id", "message", "number", "protocol", "provider", "saleId", "series", "status", "type", "updatedAt", "xmlPath") SELECT "accessKey", "createdAt", "danfePath", "environment", "id", "message", "number", "protocol", "provider", "saleId", "series", "status", "type", "updatedAt", "xmlPath" FROM "FiscalDocument";
DROP TABLE "FiscalDocument";
ALTER TABLE "new_FiscalDocument" RENAME TO "FiscalDocument";
CREATE UNIQUE INDEX "FiscalDocument_accessKey_key" ON "FiscalDocument"("accessKey");
CREATE INDEX "FiscalDocument_saleId_idx" ON "FiscalDocument"("saleId");
CREATE INDEX "FiscalDocument_status_idx" ON "FiscalDocument"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
