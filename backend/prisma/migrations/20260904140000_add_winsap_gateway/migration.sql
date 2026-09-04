-- Add WINSAP as a valid PaymentGateway value (Winsap payment-links API, Paraguay).
ALTER TYPE "PaymentGateway" ADD VALUE IF NOT EXISTS 'WINSAP';
