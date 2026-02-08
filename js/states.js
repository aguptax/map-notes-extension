// All Indian states and union territories — single source of truth
// stateId must match properties.stateId in data/india-states.geojson

const INDIA_STATES = [
  { id: "andaman-and-nicobar", name: "Andaman and Nicobar" },
  { id: "andhra-pradesh", name: "Andhra Pradesh" },
  { id: "arunachal-pradesh", name: "Arunachal Pradesh" },
  { id: "assam", name: "Assam" },
  { id: "bihar", name: "Bihar" },
  { id: "chandigarh", name: "Chandigarh" },
  { id: "chhattisgarh", name: "Chhattisgarh" },
  { id: "dadra-and-nagar-haveli", name: "Dadra and Nagar Haveli" },
  { id: "daman-and-diu", name: "Daman and Diu" },
  { id: "delhi", name: "Delhi" },
  { id: "goa", name: "Goa" },
  { id: "gujarat", name: "Gujarat" },
  { id: "haryana", name: "Haryana" },
  { id: "himachal-pradesh", name: "Himachal Pradesh" },
  { id: "jammu-and-kashmir", name: "Jammu and Kashmir" },
  { id: "jharkhand", name: "Jharkhand" },
  { id: "karnataka", name: "Karnataka" },
  { id: "kerala", name: "Kerala" },
  { id: "lakshadweep", name: "Lakshadweep" },
  { id: "madhya-pradesh", name: "Madhya Pradesh" },
  { id: "maharashtra", name: "Maharashtra" },
  { id: "manipur", name: "Manipur" },
  { id: "meghalaya", name: "Meghalaya" },
  { id: "mizoram", name: "Mizoram" },
  { id: "nagaland", name: "Nagaland" },
  { id: "odisha", name: "Odisha" },
  { id: "puducherry", name: "Puducherry" },
  { id: "punjab", name: "Punjab" },
  { id: "rajasthan", name: "Rajasthan" },
  { id: "sikkim", name: "Sikkim" },
  { id: "tamil-nadu", name: "Tamil Nadu" },
  { id: "tripura", name: "Tripura" },
  { id: "uttar-pradesh", name: "Uttar Pradesh" },
  { id: "uttarakhand", name: "Uttarakhand" },
  { id: "west-bengal", name: "West Bengal" },
];

function getStateName(stateId) {
  const state = INDIA_STATES.find((s) => s.id === stateId);
  return state ? state.name : stateId;
}
