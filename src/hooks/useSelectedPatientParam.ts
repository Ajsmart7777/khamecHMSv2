import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Syncs a "selected patient" state with the `?patient=<id>` URL query.
 * Enables deep links (e.g. from notifications) to auto-select a patient
 * on the target role page. Preserves other query params.
 */
export function useSelectedPatientParam(paramKey: string = 'patient') {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPatientId = searchParams.get(paramKey);

  const setSelectedPatientId = useCallback(
    (id: string | null) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (id) next.set(paramKey, id);
          else next.delete(paramKey);
          return next;
        },
        { replace: true },
      );
    },
    [paramKey, setSearchParams],
  );

  return [selectedPatientId, setSelectedPatientId] as const;
}