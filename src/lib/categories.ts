/**
 * Expense categories.
 *
 * Kept as a static list rather than user-editable rows: a fixed taxonomy is
 * what makes the charts comparable across groups, and every category anyone
 * actually reaches for is already here. `other` is the escape hatch.
 *
 * Icon names are lucide-react components; colours are design-token keys
 * resolved in `tokens.css`.
 */

export interface CategoryDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  group: string;
  /** Words that route a typed description to this category. */
  keywords: string[];
}

export const CATEGORY_GROUPS = [
  "Food & drink",
  "Home",
  "Travel",
  "Life",
  "Money",
] as const;

export const CATEGORIES: CategoryDef[] = [
  // Food & drink
  { id: "groceries", name: "Groceries", icon: "ShoppingCart", color: "lime", group: "Food & drink",
    keywords: ["grocer", "supermarket", "market", "tesco", "aldi", "lidl", "kroger", "safeway", "walmart", "costco", "bigbasket", "zepto", "blinkit", "veggies", "food shop"] },
  { id: "dining", name: "Restaurants", icon: "UtensilsCrossed", color: "amber", group: "Food & drink",
    keywords: ["restaurant", "dinner", "lunch", "brunch", "breakfast", "meal", "takeaway", "takeout", "delivery", "pizza", "sushi", "burger", "swiggy", "zomato", "ubereats", "doordash", "deliveroo"] },
  { id: "drinks", name: "Drinks", icon: "Beer", color: "orange", group: "Food & drink",
    keywords: ["bar", "pub", "beer", "wine", "cocktail", "drinks", "booze", "brewery", "nightcap"] },
  { id: "coffee", name: "Coffee", icon: "Coffee", color: "brown", group: "Food & drink",
    keywords: ["coffee", "cafe", "espresso", "latte", "starbucks", "tea", "chai"] },

  // Home
  { id: "rent", name: "Rent", icon: "KeyRound", color: "iris", group: "Home",
    keywords: ["rent", "lease", "landlord", "deposit"] },
  { id: "mortgage", name: "Mortgage", icon: "Landmark", color: "iris", group: "Home",
    keywords: ["mortgage", "home loan", "emi"] },
  { id: "utilities", name: "Utilities", icon: "Zap", color: "yellow", group: "Home",
    keywords: ["electric", "electricity", "power", "gas bill", "water", "utility", "utilities", "heating", "bill"] },
  { id: "internet", name: "Internet & phone", icon: "Wifi", color: "sky", group: "Home",
    keywords: ["internet", "wifi", "broadband", "phone", "mobile", "data", "airtel", "jio", "comcast", "verizon"] },
  { id: "household", name: "Household", icon: "Sofa", color: "teal", group: "Home",
    keywords: ["furniture", "cleaning", "supplies", "household", "ikea", "detergent", "toilet paper", "repairs"] },
  { id: "maintenance", name: "Maintenance", icon: "Wrench", color: "slate", group: "Home",
    keywords: ["repair", "plumber", "electrician", "maintenance", "fix", "handyman"] },

  // Travel
  { id: "accommodation", name: "Accommodation", icon: "BedDouble", color: "violet", group: "Travel",
    keywords: ["hotel", "airbnb", "hostel", "stay", "accommodation", "lodge", "resort", "booking"] },
  { id: "flights", name: "Flights", icon: "Plane", color: "sky", group: "Travel",
    keywords: ["flight", "airline", "airfare", "plane", "boarding", "ryanair", "indigo", "easyjet"] },
  { id: "transport", name: "Transport", icon: "TrainFront", color: "cyan", group: "Travel",
    keywords: ["train", "bus", "metro", "subway", "tram", "ferry", "transit", "railcard", "irctc"] },
  { id: "taxi", name: "Taxi & rideshare", icon: "Car", color: "yellow", group: "Travel",
    keywords: ["taxi", "uber", "lyft", "ola", "cab", "rideshare", "bolt", "grab"] },
  { id: "fuel", name: "Fuel", icon: "Fuel", color: "orange", group: "Travel",
    keywords: ["fuel", "petrol", "gas station", "diesel", "charging", "shell", "bp"] },
  { id: "parking", name: "Parking & tolls", icon: "CircleParking", color: "slate", group: "Travel",
    keywords: ["parking", "toll", "garage", "meter", "congestion"] },
  { id: "carrental", name: "Car rental", icon: "CarFront", color: "teal", group: "Travel",
    keywords: ["car rental", "rental car", "hertz", "avis", "zoomcar"] },

  // Life
  { id: "entertainment", name: "Entertainment", icon: "Clapperboard", color: "pink", group: "Life",
    keywords: ["cinema", "movie", "concert", "show", "theatre", "gig", "festival", "museum", "tickets", "netflix", "spotify"] },
  { id: "activities", name: "Activities", icon: "Ticket", color: "rose", group: "Life",
    keywords: ["tour", "activity", "excursion", "diving", "ski", "hike", "climbing", "park", "zoo"] },
  { id: "shopping", name: "Shopping", icon: "ShoppingBag", color: "fuchsia", group: "Life",
    keywords: ["shopping", "clothes", "amazon", "shoes", "gift", "electronics", "store"] },
  { id: "health", name: "Health", icon: "HeartPulse", color: "red", group: "Life",
    keywords: ["pharmacy", "doctor", "medicine", "hospital", "dentist", "clinic", "gym", "chemist"] },
  { id: "sports", name: "Sports", icon: "Dumbbell", color: "lime", group: "Life",
    keywords: ["gym", "sports", "football", "cricket", "tennis", "yoga", "membership", "court"] },
  { id: "education", name: "Education", icon: "GraduationCap", color: "indigo", group: "Life",
    keywords: ["course", "class", "tuition", "books", "school", "university", "workshop"] },
  { id: "pets", name: "Pets", icon: "PawPrint", color: "brown", group: "Life",
    keywords: ["pet", "dog", "cat", "vet", "kennel", "litter"] },
  { id: "childcare", name: "Childcare", icon: "Baby", color: "pink", group: "Life",
    keywords: ["childcare", "nanny", "babysitter", "daycare", "creche", "nursery"] },

  // Money
  { id: "subscriptions", name: "Subscriptions", icon: "Repeat", color: "violet", group: "Money",
    keywords: ["subscription", "netflix", "spotify", "icloud", "prime", "membership", "renewal"] },
  { id: "insurance", name: "Insurance", icon: "ShieldCheck", color: "teal", group: "Money",
    keywords: ["insurance", "premium", "cover", "policy"] },
  { id: "taxes", name: "Taxes & fees", icon: "ReceiptText", color: "slate", group: "Money",
    keywords: ["tax", "fee", "vat", "gst", "service charge", "surcharge"] },
  { id: "gifts", name: "Gifts & donations", icon: "Gift", color: "rose", group: "Money",
    keywords: ["gift", "present", "donation", "charity", "birthday", "wedding"] },
  { id: "other", name: "Other", icon: "Shapes", color: "slate", group: "Money", keywords: [] },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const DEFAULT_CATEGORY_ID = "other";

export function categoryById(id: string | null | undefined): CategoryDef {
  return (id && CATEGORY_BY_ID.get(id)) || CATEGORY_BY_ID.get(DEFAULT_CATEGORY_ID)!;
}

/**
 * Guesses a category from what the user typed.
 *
 * Runs on every keystroke in the composer to pre-select an icon, so it is a
 * plain scan rather than anything clever. Longer keywords are checked first so
 * "car rental" beats "car", and a whole-word match outranks a substring so
 * "carpet" does not become a taxi ride.
 */
export function suggestCategory(description: string): CategoryDef | null {
  const text = ` ${description.toLowerCase().trim()} `;
  if (text.trim().length < 2) return null;

  let best: { category: CategoryDef; score: number } | null = null;

  for (const category of CATEGORIES) {
    for (const keyword of category.keywords) {
      const index = text.indexOf(keyword);
      if (index === -1) continue;

      // Whole-word hits score above substring hits, longer keywords above short.
      const before = text[index - 1] ?? " ";
      const after = text[index + keyword.length] ?? " ";
      const wholeWord = !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
      const score = keyword.length * (wholeWord ? 10 : 1);

      if (!best || score > best.score) best = { category, score };
    }
  }

  // A bare substring match on a short keyword is more likely noise than signal.
  if (best && best.score < 5) return null;
  return best?.category ?? null;
}
