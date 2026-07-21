-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "audits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PENDING',
    "findings" JSONB,
    "error" TEXT,
    "fetchedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audits_tenantId_createdAt_idx" ON "audits"("tenantId", "createdAt");
