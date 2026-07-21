/*
  Warnings:

  - Added the required column `updatedAt` to the `audits` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- Backfill existing rows with now() so the NOT NULL add succeeds on a non-empty
-- table, then drop the default (Prisma manages @updatedAt at the app layer, so
-- the column needs no DB default going forward).
ALTER TABLE "audits" ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE "audits" ALTER COLUMN "updatedAt" DROP DEFAULT;
