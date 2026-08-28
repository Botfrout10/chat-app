import { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from "react-native";

type Args = {
  enabled: boolean;
  atTopRef: React.MutableRefObject<boolean>;
  onOpen: () => void;
  threshold?: number;
  /** when true, atTopRef is ignored — for a dedicated drag handle above the list */
  ignoreAtTop?: boolean;
};

export function usePullToPalette({ enabled, atTopRef, onOpen, threshold = 96, ignoreAtTop = false }: Args) {
  const [pullDistance, setPullDistance] = useState(0);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const handleRelease = useCallback(
    (_: GestureResponderEvent, g: PanResponderGestureState) => {
      const dy = g.dy;
      setPullDistance(0);
      if (dy > threshold) {
        onOpenRef.current();
      }
    },
    [threshold],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (_: GestureResponderEvent, g: PanResponderGestureState) => {
          if (!enabled) return false;
          if (!ignoreAtTop && !atTopRef.current) return false;
          return g.dy > 8 && g.dy > Math.abs(g.dx) * 1.2;
        },
        onMoveShouldSetPanResponder: (_: GestureResponderEvent, g: PanResponderGestureState) => {
          if (!enabled) return false;
          if (!ignoreAtTop && !atTopRef.current) return false;
          // only vertical pull down, not horizontal scroll
          return g.dy > 12 && g.dy > Math.abs(g.dx) * 1.2;
        },
        onMoveShouldSetPanResponderCapture: (_: GestureResponderEvent, g: PanResponderGestureState) => {
          if (!enabled) return false;
          if (!ignoreAtTop && !atTopRef.current) return false;
          return g.dy > 12 && g.dy > Math.abs(g.dx) * 1.2;
        },
        onPanResponderMove: (_: GestureResponderEvent, g: PanResponderGestureState) => {
          if (g.dy > 0 && (ignoreAtTop || atTopRef.current)) {
            // clamp for visual feedback
            setPullDistance(Math.min(g.dy, 140));
          }
        },
        onPanResponderRelease: handleRelease,
        onPanResponderTerminate: () => setPullDistance(0),
        onPanResponderTerminationRequest: () => false,
      }),
    [enabled, atTopRef, handleRelease, ignoreAtTop],
  );

  return { panHandlers: panResponder.panHandlers, pullDistance };
}
