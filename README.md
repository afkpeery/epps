# Epps Speed & Agility

Build with Node.js 22 or newer using `npm run build`. The build packages the Cloudflare Worker at `dist/server/index.js`. The Site uses the `BUCKET` R2 binding for booking requests and confirmed sessions.

## Configure the coach workflow

Set `COACH_ACCESS_KEY` to a randomly generated secret in Sites runtime settings. Coach Lim uses that key on `/coach-dashboard`. Only share it with people authorized to see booking contact details.

| Setting | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` | Send request and confirmation texts to clients who opt in. Use an approved messaging service with STOP handling. |
| `STRIPE_SECRET_KEY` | Create a client-specific hosted checkout for an agreed quote when confirming a request. |
| `STRIPE_PAYMENT_URL` | Optional existing Stripe Payment Link displayed on the home page. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional natural-language explanation of the scheduling suggestions. The provider receives times, duration and travel totals only. |
| `COACH_START_ET`, `COACH_END_ET` | Set coaching hours in HH:MM Eastern Time. Defaults to 09:00–18:00. |
| `DEFAULT_TRAVEL_MINUTES`, `TRAVEL_MINUTES_BY_ROUTE` | Override the 60-minute buffer between different locations. Route overrides are a JSON object, for example `{"pittsburgh pa|cranberry township pa":40}`. Match the location text submitted by clients. |

Coach Lim approves each scheduled session. The assistant ranks windows for the preferred date from sessions confirmed in this dashboard, using configured travel estimates. For a professional travel inquiry, discuss the actual itinerary and quote before confirming. Review successful payments in Stripe. The site does not display payment status.

The avatar comes from the public Instagram profile. The hero is an illustrative generated image. Replace it and add approved post photos when supplied.
