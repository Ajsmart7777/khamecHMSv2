import hospitalLogo from '@/assets/hospital-logo.png';

// Central hospital identity used on every printed/exported document.
export const HOSPITAL = {
  name: 'Khadija Medical Center',
  shortName: 'KMC',
  address: 'No: 53, Katsina Road, P.O. Box 121, Funtua, Katsina State, Nigeria',
  rc: 'RC: 43552',
  email: 'khamecfuntua@gmail.com',
  phone: '08033928843',
} as const;

/** Logo shown on printed headers. Empty string disables it (fallback used). */
export const HOSPITAL_LOGO: string = hospitalLogo;

/** Absolute URL of the logo — needed when printing via a new window. */
export const HOSPITAL_LOGO_URL = (() => {
  try {
    return new URL(hospitalLogo, window.location.origin).href;
  } catch {
    return hospitalLogo;
  }
})();

/** Single-line contact string: "email · 08033928843" */
export const HOSPITAL_CONTACT = `${HOSPITAL.email} · ${HOSPITAL.phone}`;
