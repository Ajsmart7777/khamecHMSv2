// Central hospital identity used on every printed/exported document.
export const HOSPITAL = {
  name: 'Khadija Medical Center',
  shortName: 'KMC',
  address: 'No: 53, Katsina Road, P.O. Box 121, Funtua, Katsina State, Nigeria',
  rc: 'RC: 43552',
  email: 'khamecfuntua@gmail.com',
  phone: '08033928843',
} as const;

/** Single-line contact string: "email · 08033928843" */
export const HOSPITAL_CONTACT = `${HOSPITAL.email} · ${HOSPITAL.phone}`;
