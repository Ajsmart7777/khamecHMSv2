import { useState } from 'react';
import { HOSPITAL, HOSPITAL_LOGO } from '@/lib/hospital';

interface PrintHeaderProps {
  /** Optional department line, e.g. "PHARMACY DEPARTMENT" */
  department?: string;
  /** Logo size in px (square). */
  size?: number;
  className?: string;
}

/**
 * Shared hospital header used on every printed / exported document.
 * Renders the hospital logo with a text-initials fallback when the image
 * is missing or fails to load.
 */
export function PrintHeader({ department, size = 56, className = '' }: PrintHeaderProps) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={`text-center ${className}`}>
      <div className="flex justify-center mb-2">
        {HOSPITAL_LOGO && !failed ? (
          <img
            src={HOSPITAL_LOGO}
            alt={`${HOSPITAL.name} logo`}
            width={size}
            height={size}
            style={{ width: size, height: size, objectFit: 'contain' }}
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-full border-2 border-current font-bold"
            style={{ width: size, height: size, fontSize: size * 0.32 }}
          >
            {HOSPITAL.shortName}
          </div>
        )}
      </div>
      <h1 className="text-base font-bold uppercase leading-tight">{HOSPITAL.name}</h1>
      {department && <p className="text-xs text-gray-600">{department}</p>}
      <p className="text-[10px] text-gray-600">{HOSPITAL.address}</p>
      <p className="text-[10px] text-gray-600">{HOSPITAL.rc}</p>
      <p className="text-[10px] text-gray-600">{HOSPITAL.email} · {HOSPITAL.phone}</p>
    </div>
  );
}
