-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "anonymizedAt" DATETIME;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "deliveredAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "discountAuthorizedById" INTEGER;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Quote" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Quote" ADD COLUMN "decidedAt" DATETIME;
ALTER TABLE "Quote" ADD COLUMN "discountAuthorizedById" INTEGER;
ALTER TABLE "Quote" ADD COLUMN "sentAt" DATETIME;

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
    "isService" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Product" ("active", "allowNegativeStock", "barcode", "brand", "cardFeeBps", "categoryId", "cest", "cfop", "commissionBps", "costCents", "createdAt", "deletedAt", "description", "freightCents", "hasVariants", "id", "imagePath", "internalCode", "minStockMilli", "name", "ncm", "otherCostsCents", "packagingCents", "pricingMode", "promoEndsAt", "promoPriceCents", "promoStartsAt", "salePriceCents", "searchText", "sku", "stockMilli", "subcategoryId", "supplierId", "targetMarginBps", "taxBps", "taxOrigin", "unit", "updatedAt", "variantOptions", "wholesaleMinMilli", "wholesalePriceCents") SELECT "active", "allowNegativeStock", "barcode", "brand", "cardFeeBps", "categoryId", "cest", "cfop", "commissionBps", "costCents", "createdAt", "deletedAt", "description", "freightCents", "hasVariants", "id", "imagePath", "internalCode", "minStockMilli", "name", "ncm", "otherCostsCents", "packagingCents", "pricingMode", "promoEndsAt", "promoPriceCents", "promoStartsAt", "salePriceCents", "searchText", "sku", "stockMilli", "subcategoryId", "supplierId", "targetMarginBps", "taxBps", "taxOrigin", "unit", "updatedAt", "variantOptions", "wholesaleMinMilli", "wholesalePriceCents" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_internalCode_key" ON "Product"("internalCode");
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");
CREATE INDEX "Product_active_deletedAt_idx" ON "Product"("active", "deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
