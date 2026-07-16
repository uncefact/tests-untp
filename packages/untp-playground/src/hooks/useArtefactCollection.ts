'use client';

import { useCallback, useRef, useState } from 'react';
import { emptyCollection } from '@/lib/artefactCollection';
import type { CollectionState } from '@/types/artefact';

/**
 * React glue for the shared per-instance collection (ADR-041). It mirrors the state into a ref
 * so a pure transition is applied against the latest value and its outcome is returned to the
 * caller for a toast fired outside any state updater (avoiding the StrictMode double-fire). Every
 * mutation goes through `dispatch`, so the ref and the state never diverge.
 */
export function useArtefactCollection<P, R>() {
  const [state, setState] = useState<CollectionState<P, R>>(() => emptyCollection<P, R>());
  const ref = useRef(state);

  const dispatch = useCallback(
    <Res extends { state: CollectionState<P, R> }>(transition: (current: CollectionState<P, R>) => Res): Res => {
      const result = transition(ref.current);
      ref.current = result.state;
      setState(result.state);
      return result;
    },
    [],
  );

  return { state, dispatch };
}
