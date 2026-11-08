"use client";
import type { Dog, Sitter } from "../lib/matching";
export const sizeNames = {
  small: "Liten",
  medium: "Mellanstor",
  large: "Stor",
};
export const serviceNames = {
  medication: "Medicinering",
  puppy: "Valpomsorg",
  senior: "Senioromsorg",
};
export const preferenceNames = {
  quiet: "Lugn miljö",
  active: "Aktiva promenader",
  garden: "Trädgård",
};
export function Checks({
  name,
  title,
  options,
  values = [],
}: {
  name: string;
  title: string;
  options: Record<string, string>;
  values?: string[];
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <div className="checks">
        {Object.entries(options).map(([value, label]) => (
          <label className="check" key={value}>
            <input
              type="checkbox"
              name={name}
              value={value}
              defaultChecked={values.includes(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function NumberField({
  name,
  label,
  value,
  min = 0,
  max,
  step = "1",
}: {
  name: string;
  label: string;
  value: number | string;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        required
      />
    </label>
  );
}
export function DogFields({ dog }: { dog?: Dog }) {
  return (
    <>
      <div className="form-grid">
        <label>
          Hundens namn
          <input name="name" defaultValue={dog?.name} maxLength={80} required />
        </label>
        <label>
          Storlek
          <select name="size" defaultValue={dog?.size ?? "medium"}>
            {Object.entries(sizeNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          name="ageYears"
          label="Ålder (år)"
          value={dog?.age_years ?? 4}
          max={30}
        />
        <label>
          Ras (valfritt)
          <input name="breed" defaultValue={dog?.breed} maxLength={100} />
        </label>
      </div>
      <label>
        Kan dela hem med andra hundar?
        <select
          name="social"
          defaultValue={dog ? String(dog.social) : ""}
          required
        >
          <option value="" disabled>
            Välj ett svar
          </option>
          <option value="true">Ja</option>
          <option value="false">Nej, behöver eget utrymme</option>
        </select>
      </label>
      <Checks
        name="requirements"
        title="Omsorg som måste kunna erbjudas"
        options={serviceNames}
        values={dog?.requirements}
      />
      <Checks
        name="preferences"
        title="Önskemål"
        options={preferenceNames}
        values={dog?.preferences}
      />
      <label>
        Privata omsorgsanteckningar
        <textarea
          name="careNotes"
          defaultValue={dog?.care_notes}
          maxLength={2000}
          rows={3}
        />
      </label>
      <p className="hint">
        Delas bara med den valda hundvakten när du skickar en förfrågan.
        Profiländringar ändrar inte redan skickade uppgifter.
      </p>
    </>
  );
}
export function SitterFields({ sitter: s }: { sitter: Sitter | null }) {
  return (
    <>
      <div className="form-grid">
        <label>
          Profilnamn
          <input name="name" defaultValue={s?.name} required maxLength={80} />
        </label>
        <label>
          Område
          <input
            name="area"
            defaultValue={s?.area ?? "Stockholm"}
            required
            maxLength={100}
          />
        </label>
        <NumberField
          name="latitude"
          label="Ungefärlig latitud"
          value={s?.latitude ?? 59.33}
          min={-90}
          max={90}
          step="0.01"
        />
        <NumberField
          name="longitude"
          label="Ungefärlig longitud"
          value={s?.longitude ?? 18.07}
          min={-180}
          max={180}
          step="0.01"
        />
        <NumberField
          name="radiusKm"
          label="Serviceområde (km)"
          value={s?.radius_km ?? 30}
          min={1}
          max={100}
        />
        <NumberField
          name="experienceYears"
          label="Erfarenhet (år)"
          value={s?.experience_years ?? 3}
          max={80}
        />
        <NumberField
          name="priceKr"
          label="Pris per hund och dag (kr)"
          value={(s?.daily_price ?? 45000) / 100}
          min={1}
          max={10000}
        />
        <NumberField
          name="capacity"
          label="Högst antal gästande hundar"
          value={s?.capacity ?? 2}
          min={1}
          max={10}
        />
      </div>
      <p className="hint">
        Ange en allmän plats för området, aldrig din exakta hemadress. Priset är
        ett demoexempel, ingen betalning sker.
      </p>
      <label>
        Beskrivning
        <textarea
          name="description"
          defaultValue={s?.description}
          maxLength={2000}
          rows={3}
        />
      </label>
      <label>
        Finns egna hundar i hemmet?
        <select
          name="residentDogs"
          defaultValue={s ? String(s.resident_dogs) : ""}
          required
        >
          <option value="" disabled>
            Välj ett svar
          </option>
          <option value="false">Nej</option>
          <option value="true">Ja</option>
        </select>
      </label>
      <Checks
        name="sizes"
        title="Hundstorlekar du tar emot"
        options={sizeNames}
        values={s?.sizes ?? ["small", "medium", "large"]}
      />
      <Checks
        name="services"
        title="Omsorg du kan erbjuda"
        options={serviceNames}
        values={s?.services}
      />
      <Checks
        name="preferences"
        title="Miljö och aktiviteter"
        options={preferenceNames}
        values={s?.preferences}
      />
    </>
  );
}
export const formString = (f: FormData, k: string) => String(f.get(k) ?? "");
export const formNumber = (f: FormData, k: string) => Number(f.get(k));
export function dogInput(f: FormData, id?: string) {
  return {
    id,
    name: formString(f, "name"),
    size: formString(f, "size"),
    ageYears: formNumber(f, "ageYears"),
    breed: formString(f, "breed"),
    social: f.get("social") === "true",
    requirements: f.getAll("requirements"),
    preferences: f.getAll("preferences"),
    careNotes: formString(f, "careNotes"),
  };
}
export function sitterInput(f: FormData) {
  return {
    name: formString(f, "name"),
    area: formString(f, "area"),
    latitude: formNumber(f, "latitude"),
    longitude: formNumber(f, "longitude"),
    radiusKm: formNumber(f, "radiusKm"),
    description: formString(f, "description"),
    sizes: f.getAll("sizes"),
    experienceYears: formNumber(f, "experienceYears"),
    dailyPrice: Math.round(formNumber(f, "priceKr") * 100),
    capacity: formNumber(f, "capacity"),
    residentDogs: f.get("residentDogs") === "true",
    services: f.getAll("services"),
    preferences: f.getAll("preferences"),
  };
}
