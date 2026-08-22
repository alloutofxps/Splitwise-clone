"use client";

import {
  Baby, BedDouble, Beer, Car, CarFront, CircleParking, Clapperboard, Coffee,
  Dumbbell, Fuel, Gift, GraduationCap, HeartPulse, KeyRound, Landmark, PawPrint,
  Plane, ReceiptText, Repeat, Shapes, ShieldCheck, ShoppingBag, ShoppingCart,
  Sofa, Ticket, TrainFront, UtensilsCrossed, Wifi, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Category icons, looked up by the name stored in the taxonomy.
 *
 * An explicit map rather than a dynamic import: the set is small and fixed, and
 * this keeps every icon in the main bundle where it can be rendered instantly
 * in a list, instead of popping in one lazy chunk at a time as the user scrolls.
 */
const ICONS: Record<string, LucideIcon> = {
  Baby, BedDouble, Beer, Car, CarFront, CircleParking, Clapperboard, Coffee,
  Dumbbell, Fuel, Gift, GraduationCap, HeartPulse, KeyRound, Landmark, PawPrint,
  Plane, ReceiptText, Repeat, Shapes, ShieldCheck, ShoppingBag, ShoppingCart,
  Sofa, Ticket, TrainFront, UtensilsCrossed, Wifi, Wrench, Zap,
};

export function CategoryGlyph({
  name,
  className = "size-[18px]",
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? Shapes;
  return <Icon className={className} />;
}
