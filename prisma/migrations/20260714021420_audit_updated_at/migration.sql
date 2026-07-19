/*
  Warnings:

  - Added the required column `updatedAt` to the `audits` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "audits" ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL;
