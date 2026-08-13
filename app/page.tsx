import type { Metadata } from "next";
import RentwiseApp from "./rentwise-app";

export const metadata: Metadata = {
  title: "Rento — Rental management for landlords",
  description: "A private, mobile-first workspace for properties, tenants, agreements, rent receipts, expenses and reports.",
};

export default function Home() {
  return <RentwiseApp />;
}
