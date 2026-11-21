import { ArrowUp, ArrowUpLeft, ArrowUpRight, CircleDot, CornerUpLeft, CornerUpRight, DoorOpen, Flag, LogOut, TrendingUp, Undo2, type LucideIcon } from 'lucide-react';
import type { RouteStep } from '@/api/types';
import { ElevatorIcon, StairsIcon } from '@/features/map/icons';

/** Turn arrows are physical directions: they are NOT mirrored in RTL. */
const TURN: Record<NonNullable<RouteStep['turn']>, LucideIcon> = {
  STRAIGHT: ArrowUp,
  SLIGHT_LEFT: ArrowUpLeft,
  LEFT: CornerUpLeft,
  SHARP_LEFT: CornerUpLeft,
  SLIGHT_RIGHT: ArrowUpRight,
  RIGHT: CornerUpRight,
  SHARP_RIGHT: CornerUpRight,
  U_TURN: Undo2,
};

export function stepIcon(step: Pick<RouteStep, 'type' | 'turn'>): LucideIcon {
  switch (step.type) {
    case 'START':
      return CircleDot;
    case 'ARRIVE':
      return Flag;
    case 'ELEVATOR':
      return ElevatorIcon;
    case 'STAIRS':
    case 'STEPS':
      return StairsIcon;
    case 'RAMP':
      return TrendingUp;
    case 'ENTER':
      return DoorOpen;
    case 'EXIT':
      return LogOut;
    default:
      return TURN[step.turn ?? 'STRAIGHT'];
  }
}
