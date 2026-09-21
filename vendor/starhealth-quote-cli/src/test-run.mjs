import { runQuote } from "./index.js";

await runQuote({
  pincode: "600001",
  category: "Health",
  product: "Recommend Me",
  sumInsured: "15 Lakh",
  policyPeriod: "2 Years",
  policyPlan: "Fresh",
  policyType: "Floater",
  numParents: 0,
  numAdults: 1,
  numChildren: 1,
  members: [
    { type: "Adult", index: 1, age: "30 yrs" },
    { type: "Child", index: 1, age: "10 yrs" },
  ],
  ped: "No",
});
