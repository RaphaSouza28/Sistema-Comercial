-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "internalCode" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" INTEGER,
    "subcategoryId" INTEGER,
    "brand" TEXT,
    "supplierId" INTEGER,
    "imagePath" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "freightCents" INTEGER NOT NULL DEFAULT 0,
    "packagingCents" INTEGER NOT NULL DEFAULT 0,
    "otherCostsCents" INTEGER NOT NULL DEFAULT 0,
    "salePriceCents" INTEGER NOT NULL DEFAULT 0,
    "promoPriceCents" INTEGER,
    "promoStartsAt" DATETIME,
    "promoEndsAt" DATETIME,
    "wholesalePriceCents" INTEGER,
    "wholesaleMinMilli" INTEGER,
    "targetMarginBps" INTEGER,
    "taxBps" INTEGER,
    "cardFeeBps" INTEGER,
    "commissionBps" INTEGER,
    "stockMilli" INTEGER NOT NULL DEFAULT 0,
    "minStockMilli" INTEGER NOT NULL DEFAULT 0,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "pricingMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "hasVariants" BOOLEAN NOT NULL DEFAULT false,
    "variantOptions" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "ncm" TEXT,
    "cest" TEXT,
    "cfop" TEXT,
    "taxOrigin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("active", "allowNegativeStock", "barcode", "brand", "cardFeeBps", "categoryId", "cest", "cfop", "commissionBps", "costCents", "createdAt", "deletedAt", "description", "freightCents", "hasVariants", "id", "imagePath", "internalCode", "minStockMilli", "name", "ncm", "otherCostsCents", "packagingCents", "promoEndsAt", "promoPriceCents", "promoStartsAt", "salePriceCents", "sku", "stockMilli", "subcategoryId", "supplierId", "targetMarginBps", "taxBps", "taxOrigin", "unit", "updatedAt", "wholesaleMinMilli", "wholesalePriceCents") SELECT "active", "allowNegativeStock", "barcode", "brand", "cardFeeBps", "categoryId", "cest", "cfop", "commissionBps", "costCents", "createdAt", "deletedAt", "description", "freightCents", "hasVariants", "id", "imagePath", "internalCode", "minStockMilli", "name", "ncm", "otherCostsCents", "packagingCents", "promoEndsAt", "promoPriceCents", "promoStartsAt", "salePriceCents", "sku", "stockMilli", "subcategoryId", "supplierId", "targetMarginBps", "taxBps", "taxOrigin", "unit", "updatedAt", "wholesaleMinMilli", "wholesalePriceCents" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_internalCode_key" ON "Product"("internalCode");
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");
CREATE INDEX "Product_active_deletedAt_idx" ON "Product"("active", "deletedAt");
CREATE TABLE "new_Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contactName" TEXT,
    "zipCode" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Supplier" ("active", "city", "complement", "contactName", "createdAt", "deletedAt", "district", "document", "email", "id", "name", "notes", "number", "phone", "state", "street", "tradeName", "updatedAt", "zipCode") SELECT "active", "city", "complement", "contactName", "createdAt", "deletedAt", "district", "document", "email", "id", "name", "notes", "number", "phone", "state", "street", "tradeName", "updatedAt", "zipCode" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
