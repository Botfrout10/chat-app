import { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from "react-native";

type Args = {
  enabled: boolean;
  atTopRef: React.MutableRefObject<boolean>;
  onOpen: () => void;
  threshold?: number;
};

export function usePullToPalette({ enabled, atTopRef, onOpen, threshold = 96 }: Args) {
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
        onMoveShouldSetPanResponder: (_: GestureResponderEvent, g: PanResponderGestureState) => {
          if (!enabled) return false;
          if (!atTopRef.current) return false;
          // only vertical pull down, not horizontal scroll
          return g.dy > 12 && g.dy > Math.abs(g.dx) * 1.2;
        },
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderMove: (_: GestureResponderEvent, g: PanResponderGestureState) => {
          if (g.dy > 0 && atTopRef.current) {
            // clamp for visual feedback
            setPullDistance(Math.min(g.dy, 140));
          }
        },
        onPanResponderRelease: handleRelease,
        onPanResponderTerminate: () => setPullDistance(0),
        onPanResponderTerminationRequest: () => true,
      }),
    [enabled, atTopRef, handleRelease],
  );

  return { panHandlers: panResponder.panHandlers, pullDistance };
}
