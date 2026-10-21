-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "creditLimitCents" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccountPayable" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "supplierId" INTEGER,
    "category" TEXT,
    "documentNumber" TEXT,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "paidCents" INTEGER,
    "paymentMethod" TEXT,
    "paidFromCash" BOOLEAN NOT NULL DEFAULT false,
    "paymentKey" TEXT,
    "paidById" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "receiptPath" TEXT,
    "receiptName" TEXT,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "recurrenceSourceId" INTEGER,
    "notes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountPayable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountPayable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountPayable_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountPayable_recurrenceSourceId_fkey" FOREIGN KEY ("recurrenceSourceId") REFERENCES "AccountPayable" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AccountPayable" ("amountCents", "cancelledAt", "category", "createdAt", "description", "dueDate", "id", "notes", "paidAt", "paidCents", "paymentMethod", "receiptPath", "recurrence", "status", "supplierId", "updatedAt") SELECT "amountCents", "cancelledAt", "category", "createdAt", "description", "dueDate", "id", "notes", "paidAt", "paidCents", "paymentMethod", "receiptPath", "recurrence", "status", "supplierId", "updatedAt" FROM "AccountPayable";
DROP TABLE "AccountPayable";
ALTER TABLE "new_AccountPayable" RENAME TO "AccountPayable";
CREATE UNIQUE INDEX "AccountPayable_paymentKey_key" ON "AccountPayable"("paymentKey");
CREATE UNIQUE INDEX "AccountPayable_recurrenceSourceId_key" ON "AccountPayable"("recurrenceSourceId");
CREATE INDEX "AccountPayable_status_dueDate_idx" ON "AccountPayable"("status", "dueDate");
CREATE INDEX "AccountPayable_paidAt_idx" ON "AccountPayable"("paidAt");
CREATE TABLE "new_AccountReceivable" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "description" TEXT NOT NULL,
    "customerId" INTEGER,
    "saleId" INTEGER,
    "installmentNumber" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "receivedCents" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" INTEGER,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountReceivable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountReceivable_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountReceivable_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AccountReceivable" ("amountCents", "cancelledAt", "createdAt", "customerId", "description", "dueDate", "id", "installmentNumber", "notes", "receivedCents", "saleId", "status", "updatedAt") SELECT "amountCents", "cancelledAt", "createdAt", "customerId", "description", "dueDate", "id", "installmentNumber", "notes", "receivedCents", "saleId", "status", "updatedAt" FROM "AccountReceivable";
DROP TABLE "AccountReceivable";
ALTER TABLE "new_AccountReceivable" RENAME TO "AccountReceivable";
CREATE INDEX "AccountReceivable_status_dueDate_idx" ON "AccountReceivable"("status", "dueDate");
CREATE UNIQUE INDEX "AccountReceivable_saleId_installmentNumber_key" ON "AccountReceivable"("saleId", "installmentNumber");
CREATE TABLE "new_ReceivablePayment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receivableId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "interestCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "cashSessionId" INTEGER,
    "reversedAt" DATETIME,
    "reversedById" INTEGER,
    "reverseReason" TEXT,
    CONSTRAINT "ReceivablePayment_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "AccountReceivable" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReceivablePayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReceivablePayment_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReceivablePayment" ("amountCents", "id", "idempotencyKey", "method", "paidAt", "receivableId", "userId") SELECT "amountCents", "id", "idempotencyKey", "method", "paidAt", "receivableId", "userId" FROM "ReceivablePayment";
DROP TABLE "ReceivablePayment";
ALTER TABLE "new_ReceivablePayment" RENAME TO "ReceivablePayment";
CREATE UNIQUE INDEX "ReceivablePayment_idempotencyKey_key" ON "ReceivablePayment"("idempotencyKey");
CREATE INDEX "ReceivablePayment_receivableId_idx" ON "ReceivablePayment"("receivableId");
CREATE INDEX "ReceivablePayment_paidAt_idx" ON "ReceivablePayment"("paidAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
