import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { FLAT_COURSES } from "../training/courses";
import { useNavigate } from "react-router-dom";
import API_URL from "../../config/api";
import { executeRecaptcha, RECAPTCHA_SITE_KEY } from "../../config/recaptcha";

// ─── Config ────────────────────────────────────────────────────────────────
const COOLDOWN_MS = 60_000;

// ─── Constants ─────────────────────────────────────────────────────────────
const FUNDING_OPTIONS = [
  "Personal / Individual",
  "Company / Corporate",
  "Government / NGO",
];

const COURSE_LABELS = FLAT_COURSES.map((c) => c.label);
const DEFAULT_COURSE = COURSE_LABELS[0] ?? "";

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const isValidMobileNumber = (value) => {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, "");
  return /^\+?[0-9\s()-]+$/.test(trimmedValue) && digits.length >= 7 && digits.length <= 15;
};

const SERVICE_INTEREST_OPTIONS = ["IT Consultancy", "Software Development", "Both"];

const PROJECT_SCALE_OPTIONS = [
  "Personal / Freelance",
  "Small to Medium Business",
  "Large Enterprise",
  "Government / Corporate",
];

const TIMELINE_OPTIONS = [
  "ASAP (within 2 weeks)",
  "Within 1 month",
  "Within 3 months",
  "Flexible",
];

const BUDGET_OPTIONS = [
  "Below ₱100K",
  "₱100K–₱500K",
  "₱500K–₱1M",
  "₱1M and above",
  "To be discussed",
];

// ─── Inquiry Type Selector Options ────────────────────────────────────────
const INQUIRY_TYPE_OPTIONS = [
  {
    value: "training",
    label: "Training",
    description: "Enroll in a course or certification program",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        />
      </svg>
    ),
  },
  {
    value: "solutions",
    label: "ICT Solutions",
    description: "Inquire about network, security, or engineering solutions",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18"
        />
      </svg>
    ),
  },
];

// ─── Custom Hook ───────────────────────────────────────────────────────────
function useEnrollForm(onClose, initialStep = 0, initialInquiryType = null, preselectedCourse = null) {
  const resolvedCourse = preselectedCourse ?? DEFAULT_COURSE;

  const [step, setStep] = useState(initialStep);
  const [inquiryType, setInquiryType] = useState(initialInquiryType);
  const [status, setStatus] = useState("idle");
  const [honeypot, setHoneypot] = useState("");
  const cooldownRef = useRef(null);

  const [trainingForm, setTrainingForm] = useState({
    funding: FUNDING_OPTIONS[0],
    attendees: "",
    name: "",
    email: "",
    phone: "",
    course: resolvedCourse,
    message: "",
  });

  const [solutionsForm, setSolutionsForm] = useState({
    name: "",
    email: "",
    phone: "",
    serviceInterest: "",
    projectScale: "",
    timeline: "",
    budget: "",
    projectDesc: "",
    techSpecs: "",
    message: "",
  });

  const [errors, setErrors] = useState({});

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  const updateTraining = (field) => (e) =>
    setTrainingForm((prev) => ({ ...prev, [field]: e.target.value }));
  const updateSolutionsEvent = (field) => (e) =>
    setSolutionsForm((prev) => ({ ...prev, [field]: e.target.value }));

  const selectInquiryType = (type) => { setInquiryType(type); setStep(1); };

  const validateTrainingStep1 = () => {
    const e = {};
    if (!trainingForm.attendees || isNaN(trainingForm.attendees) || Number(trainingForm.attendees) < 1)
      e.attendees = "Enter a valid number of attendees.";
    if (!trainingForm.name.trim()) e.name = "Name or company is required.";
    if (!isValidEmail(trainingForm.email)) e.email = "Enter a valid email address.";
    if (!trainingForm.phone.trim()) e.phone = "Mobile number is required.";
    else if (!isValidMobileNumber(trainingForm.phone)) e.phone = "Enter a valid mobile number.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateTrainingStep2 = () => {
    const e = {};
    if (!trainingForm.course) e.course = "Please select a course.";
    if (!RECAPTCHA_SITE_KEY) e.captcha = "CAPTCHA is not configured. Please contact us directly.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateSolutionsStep1 = () => {
    const e = {};
    if (!solutionsForm.name.trim()) e.name = "Name or company is required.";
    if (!isValidEmail(solutionsForm.email)) e.email = "Enter a valid email address.";
    if (!solutionsForm.phone.trim()) e.phone = "Mobile number is required.";
    else if (!isValidMobileNumber(solutionsForm.phone)) e.phone = "Enter a valid mobile number.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateSolutionsStep2 = () => {
    const e = {};
    if (!solutionsForm.serviceInterest) e.serviceInterest = "Please select a service.";
    if (!solutionsForm.projectScale) e.projectScale = "Please select a project scale.";
    if (!solutionsForm.timeline) e.timeline = "Please select a timeline.";
    if (!solutionsForm.budget) e.budget = "Please select a budget range.";
    if (!solutionsForm.projectDesc.trim()) e.projectDesc = "Please describe your project.";
    if (!RECAPTCHA_SITE_KEY) e.captcha = "CAPTCHA is not configured. Please contact us directly.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (inquiryType === "training" && validateTrainingStep1()) setStep(2);
    if (inquiryType === "solutions" && validateSolutionsStep1()) setStep(2);
  };

  const back = () => {
    setErrors({});
    step === 1 && initialInquiryType ? onClose() : setStep(1);
  };

  const backToSelection = () => { setErrors({}); setStep(0); setInquiryType(null); };

  const checkRateLimit = () => {
    const lastSent = localStorage.getItem("lastModalSubmit");
    const now = Date.now();
    if (lastSent && now - Number(lastSent) < COOLDOWN_MS) {
      clearInterval(cooldownRef.current);
      const sLeft = Math.ceil((COOLDOWN_MS - (now - Number(lastSent))) / 1000);
      setErrors({ submit: `Please wait ${sLeft}s before sending again.` });
      cooldownRef.current = setInterval(() => {
        const s = Math.ceil(
          (COOLDOWN_MS - (Date.now() - Number(localStorage.getItem("lastModalSubmit")))) / 1000,
        );
        if (s <= 0) { clearInterval(cooldownRef.current); setErrors((p) => ({ ...p, submit: "" })); }
        else { setErrors((p) => ({ ...p, submit: `Please wait ${s}s before sending again.` })); }
      }, 1000);
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (honeypot) return;
    if (!checkRateLimit()) return;

    const valid = inquiryType === "training"
      ? validateTrainingStep2()
      : validateSolutionsStep2();
    if (!valid) return;

    setStatus("loading");
    const captchaAction = inquiryType === "training" ? "training_inquiry" : "solutions_inquiry";
    let captchaToken;
    try {
      captchaToken = await executeRecaptcha(captchaAction);
    } catch (error) {
      setStatus("idle");
      setErrors({
        captcha: error instanceof Error
          ? error.message
          : "CAPTCHA could not load. Check your connection and try again.",
      });
      return;
    }

    setErrors((current) => ({ ...current, captcha: "" }));
    try {
      const payload = inquiryType === "training"
        ? {
          inquiry_type: "Training Inquiry",
          name: trainingForm.name,
          email: trainingForm.email,
          phone: trainingForm.phone,
          captchaToken,
          subject: "New Training Inquiry",
          message: trainingForm.message || "No additional message.",
          funding: trainingForm.funding,
          attendees: trainingForm.attendees,
          course: trainingForm.course || "N/A",
        }
        : {
          inquiry_type: "ICT Solutions Inquiry",
          name: solutionsForm.name,
          email: solutionsForm.email,
          phone: solutionsForm.phone,
          captchaToken,
          subject: "New ICT Solutions Inquiry",
          message: solutionsForm.message || "No additional message.",
          service_interest: solutionsForm.serviceInterest,
          project_scale: solutionsForm.projectScale,
          timeline: solutionsForm.timeline,
          budget: solutionsForm.budget,
          project_desc: solutionsForm.projectDesc,
          tech_specs: solutionsForm.techSpecs || "N/A",
        };

      const response = await fetch(`${API_URL}/inquires`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 400) {
        setStatus("idle");
        setErrors({ captcha: "CAPTCHA verification failed. Please try again." });
        return;
      }
      if (!response.ok) throw new Error("Inquiry submission failed.");

      localStorage.setItem("lastModalSubmit", Date.now());
      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  const reset = () => {
    clearInterval(cooldownRef.current);
    setStep(initialStep);
    setInquiryType(initialInquiryType);
    setStatus("idle");
    setErrors({});
    setHoneypot("");
    setTrainingForm({
      funding: FUNDING_OPTIONS[0], attendees: "", name: "", email: "",
      phone: "", course: resolvedCourse, message: "",
    });
    setSolutionsForm({
      name: "", email: "", phone: "", serviceInterest: "",
      projectScale: "", timeline: "", budget: "", projectDesc: "", techSpecs: "", message: "",
    });
  };

  return {
    step, inquiryType, trainingForm, solutionsForm, errors, status,
    cooldownRef, honeypot, setHoneypot,
    updateTraining, updateSolutionsEvent, selectInquiryType,
    next, back, backToSelection, submit, reset, onClose,
  };
}

// ─── Shared UI Primitives ──────────────────────────────────────────────────
function FieldError({ msg }) {
  return msg ? (
    <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
      <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
          clipRule="evenodd" />
      </svg>
      {msg}
    </p>
  ) : null;
}

function Input({ label, id, error, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      <input
        id={id}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition
          focus:ring-2 focus:ring-blue-500 focus:border-transparent
          ${error ? "border-red-400 bg-red-50" : "border-gray-200 bg-white hover:border-blue-300"}`}
        {...props}
      />
      <FieldError msg={error} />
    </div>
  );
}

function SelectField({ label, id, options, error, value, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <select
          id={id} value={value} onChange={onChange}
          className={`w-full appearance-none rounded-lg border px-3 py-2.5 text-sm outline-none
            transition focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10
            ${error ? "border-red-400 bg-red-50" : "border-gray-200 bg-white hover:border-blue-300"}
            ${!value ? "text-gray-400" : "text-gray-800"}`}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      <FieldError msg={error} />
    </div>
  );
}

function CaptchaField({ error }) {
  return (
    <div className="flex flex-col gap-1">
      {RECAPTCHA_SITE_KEY ? (
        <p className="text-xs text-gray-500">Protected by Google reCAPTCHA.</p>
      ) : (
        <p className="text-sm text-gray-500">
          CAPTCHA is temporarily unavailable. Please contact us directly.
        </p>
      )}
      <FieldError msg={error} />
    </div>
  );
}

function ProgressBar({ step }) {
  if (step === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-semibold tracking-widest text-blue-600 uppercase">
          Step {step} of 2
        </span>
        <span className="text-xs text-gray-400">{step === 1 ? "50%" : "100%"}</span>
      </div>
      <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-600 rounded-full transition-all duration-500 ease-out"
          style={{ width: step === 1 ? "50%" : "100%" }} />
      </div>
    </div>
  );
}

function ModalHeader({ title, subtitle }) {
  return (
    <div className="flex items-start justify-between mb-1">
      <div>
        <h5 className="font-bold text-gray-900">{title}</h5>
        <p className="text-gray-500 mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

function InquiryBadge({ inquiryType }) {
  return (
    <div className="mt-2 mb-1">
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-[#1775EE] text-xs font-semibold">
        {inquiryType === "training" ? "📚 Training Inquiry" : "🖥️ ICT Solutions Inquiry"}
      </span>
    </div>
  );
}

// ─── Step 0 — Inquiry Type Selection ──────────────────────────────────────
function Step0({ onSelect }) {
  return (
    <>
      <ModalHeader
        title={<>What are you <span className="text-[#1775EE]">inquiring about?</span></>}
        subtitle="Select the type of inquiry to get started."
      />
      <div className="flex flex-col gap-4 mt-6">
        {INQUIRY_TYPE_OPTIONS.map((opt) => (
          <button type="button" key={opt.value} onClick={() => onSelect(opt.value)}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-100
              hover:border-blue-400 hover:bg-blue-50 active:scale-98 transition-all duration-200
              text-left group"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-50 group-hover:bg-blue-100
              flex items-center justify-center text-[#1775EE] shrink-0 transition-colors duration-200">
              {opt.icon}
            </div>
            <div>
              <p className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                {opt.label}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">{opt.description}</p>
            </div>
            <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-400 ml-auto shrink-0 transition-colors"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </>
  );
}

// ─── Training Steps ────────────────────────────────────────────────────────
function TrainingStep1({ trainingForm, errors, updateTraining, next, backToSelection, back, initialInquiryType, honeypot, setHoneypot }) {
  const handleBack = initialInquiryType ? back : backToSelection;
  return (
    <>
      <ModalHeader
        title={<>Begin Your <span className="text-[#1775EE]">Learning Journey</span></>}
        subtitle="Fill out the form to secure your slot or learn more about the course."
      />
      <input type="text" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
        className="hidden" tabIndex="-1" autoComplete="off" aria-hidden="true" />
      <InquiryBadge inquiryType="training" />
      <h5 className="font-bold text-gray-900 mb-4">Individual / Company Info</h5>
      <div className="flex flex-col gap-4">
        <SelectField label="Choose Funding" id="funding" options={FUNDING_OPTIONS}
          value={trainingForm.funding} onChange={updateTraining("funding")} />
        <Input label="Number of Attendees" id="attendees" type="number" min="1"
          placeholder="e.g. 3" value={trainingForm.attendees}
          onChange={updateTraining("attendees")} error={errors.attendees} />
        <Input label="Name / Company" id="name" placeholder="Juan dela Cruz"
          value={trainingForm.name} onChange={updateTraining("name")} error={errors.name} />
        <Input label="Email" id="email" type="email" placeholder="juan@company.com"
          value={trainingForm.email} onChange={updateTraining("email")} error={errors.email} />
        <Input label="Phone Number" id="phone" type="tel" placeholder="+63 912 345 6789"
          value={trainingForm.phone} onChange={updateTraining("phone")} error={errors.phone} />
      </div>
      <div className="mt-6 flex justify-between items-center">
        <button type="button" onClick={handleBack}
          className="px-5 py-2.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600
            hover:border-blue-400 hover:text-blue-600 active:scale-95 transition-all duration-150">
          ← Back
        </button>
        <button type="button" onClick={next}
          className="px-6 py-2.5 rounded-lg bg-[#1775EE] text-white text-sm font-semibold
            hover:bg-blue-700 active:scale-95 transition-all duration-150 shadow-sm shadow-blue-200">
          Next →
        </button>
      </div>
    </>
  );
}

function TrainingStep2({ trainingForm, errors, updateTraining, back, submit, status }) {
  const isLoading = status === "loading";
  return (
    <>
      <ModalHeader
        title={<>Begin Your <span className="text-[#1775EE]">Learning Journey</span></>}
        subtitle="Fill out the form to secure your slot or learn more about the course."
      />
      <InquiryBadge inquiryType="training" />
      <h5 className="font-bold text-gray-900">Course Details</h5>
      <div className="flex flex-col gap-4">
        <SelectField label="Course to Take" id="course" options={COURSE_LABELS}
          value={trainingForm.course} onChange={updateTraining("course")} error={errors.course} />
        <div className="flex flex-col gap-1">
          <label htmlFor="t-message" className="text-sm font-medium text-gray-700">
            Message <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea id="t-message" rows={3}
            placeholder="Any specific topics, questions, or scheduling preferences..."
            value={trainingForm.message} onChange={updateTraining("message")}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none
              resize-none transition hover:border-blue-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <CaptchaField error={errors.captcha} />
      </div>
      {status === "error" && <ErrorBanner />}
      <p className="mt-4 text-xs text-gray-400 leading-relaxed">
        We'll email you a quotation within 1–2 business days. By submitting, you agree to be contacted about our solutions and schedules.
      </p>
      <StepNavButtons back={back} submit={submit} isLoading={isLoading} errors={errors} />
    </>
  );
}

// ─── Solutions Steps ────────────────────────────────────────────────────────
function SolutionsStep1({ solutionsForm, errors, updateSolutionsEvent, next, backToSelection, honeypot, setHoneypot }) {
  return (
    <>
      <ModalHeader
        title={<>Tell Us About Your <span className="text-[#1775EE]">Project</span></>}
        subtitle="Help us understand what you need so we can prepare the best proposal."
      />
      <input type="text" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
        className="hidden" tabIndex="-1" autoComplete="off" aria-hidden="true" />
      <InquiryBadge inquiryType="solutions" />
      <h5 className="font-bold text-gray-900 mb-4">Contact Info</h5>
      <div className="flex flex-col gap-4">
        <Input label="Name / Company" id="s-name" placeholder="Juan dela Cruz / ACME Corp"
          value={solutionsForm.name} onChange={updateSolutionsEvent("name")} error={errors.name} />
        <Input label="Email" id="s-email" type="email" placeholder="juan@company.com"
          value={solutionsForm.email} onChange={updateSolutionsEvent("email")} error={errors.email} />
        <Input label="Phone Number" id="s-phone" type="tel" placeholder="+63 912 345 6789"
          value={solutionsForm.phone} onChange={updateSolutionsEvent("phone")} error={errors.phone} />
      </div>
      <div className="mt-6 flex justify-between items-center">
        <button type="button" onClick={backToSelection}
          className="px-5 py-2.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600
            hover:border-blue-400 hover:text-blue-600 active:scale-95 transition-all duration-150">
          ← Back
        </button>
        <button type="button" onClick={next}
          className="px-6 py-2.5 rounded-lg bg-[#1775EE] text-white text-sm font-semibold
            hover:bg-blue-700 active:scale-95 transition-all duration-150 shadow-sm shadow-blue-200">
          Next →
        </button>
      </div>
    </>
  );
}

function SolutionsStep2({ solutionsForm, errors, updateSolutionsEvent, back, submit, status }) {
  const isLoading = status === "loading";
  return (
    <>
      <ModalHeader
        title={<>Service <span className="text-[#1775EE]">Details</span></>}
        subtitle="The more you share, the better we can tailor our proposal for you."
      />
      <InquiryBadge inquiryType="solutions" />
      <div className="flex flex-col gap-4">
        <SelectField label="Service of Interest" id="serviceInterest"
          options={SERVICE_INTEREST_OPTIONS} value={solutionsForm.serviceInterest}
          onChange={updateSolutionsEvent("serviceInterest")}
          error={errors.serviceInterest} placeholder="Select a service" />
        <SelectField label="Project Scale" id="projectScale"
          options={PROJECT_SCALE_OPTIONS} value={solutionsForm.projectScale}
          onChange={updateSolutionsEvent("projectScale")}
          error={errors.projectScale} placeholder="Select project scale" />
        <SelectField label="Project Timeline / Urgency" id="timeline"
          options={TIMELINE_OPTIONS} value={solutionsForm.timeline}
          onChange={updateSolutionsEvent("timeline")}
          error={errors.timeline} placeholder="Select a timeline" />
        <SelectField label="Estimated Budget Range" id="budget"
          options={BUDGET_OPTIONS} value={solutionsForm.budget}
          onChange={updateSolutionsEvent("budget")}
          error={errors.budget} placeholder="Select a budget range" />
        <div className="flex flex-col gap-1">
          <label htmlFor="s-desc" className="text-sm font-medium text-gray-700">
            Brief Project Description <span className="text-red-400">*</span>
          </label>
          <textarea id="s-desc" rows={3}
            placeholder="What do you need done? What problem are you trying to solve?"
            value={solutionsForm.projectDesc} onChange={updateSolutionsEvent("projectDesc")}
            className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none resize-none
              transition hover:border-blue-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent
              ${errors.projectDesc ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
          <FieldError msg={errors.projectDesc} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="s-tech" className="text-sm font-medium text-gray-700">
            Technical Requirements <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea id="s-tech" rows={2}
            placeholder="Any specific systems, platforms, or tools involved?"
            value={solutionsForm.techSpecs} onChange={updateSolutionsEvent("techSpecs")}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none
              resize-none transition hover:border-blue-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="s-message" className="text-sm font-medium text-gray-700">
            Additional Message <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea id="s-message" rows={2} placeholder="Anything else you'd like us to know?"
            value={solutionsForm.message} onChange={updateSolutionsEvent("message")}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none
              resize-none transition hover:border-blue-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <CaptchaField error={errors.captcha} />
      </div>
      {status === "error" && <ErrorBanner />}
      <p className="mt-4 text-xs text-gray-400 leading-relaxed">
        We'll get back to you within 1–2 business days. By submitting, you agree to be contacted about our solutions.
      </p>
      <StepNavButtons back={back} submit={submit} isLoading={isLoading} errors={errors} />
    </>
  );
}

// ─── Shared Sub-components ─────────────────────────────────────────────────
function ErrorBanner() {
  return (
    <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600 flex items-center gap-2">
      <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd" />
      </svg>
      Something went wrong. Please try again or contact us directly.
    </div>
  );
}

function StepNavButtons({ back, submit, isLoading, errors }) {
  return (
    <>
      {errors.submit && (
        <div className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-700 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 102 0V6zm-1 8a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd" />
          </svg>
          {errors.submit}
        </div>
      )}
      <div className="mt-5 flex justify-between items-center">
        <button type="button" onClick={back} disabled={isLoading}
          className="px-5 py-2.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600
            hover:border-blue-400 hover:text-blue-600 active:scale-95 transition-all duration-150
            disabled:opacity-40 disabled:cursor-not-allowed">
          ← Back
        </button>
        <button type="button" onClick={submit} disabled={isLoading}
          className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold
            hover:bg-blue-700 active:scale-95 transition-all duration-150 shadow-sm shadow-blue-200
            disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2">
          {isLoading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Sending...
            </>
          ) : "Submit"}
        </button>
      </div>
    </>
  );
}

function SuccessScreen({ onClose, reset }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Inquiry Sent!</h2>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
        Thanks for reaching out. We'll get back to you within 1–2 business days.
      </p>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={reset}
          className="px-5 py-2.5 rounded-lg border border-gray-200 text-sm font-semibold
            text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-all duration-150">
          Submit Another
        </button>
        <button type="button" onClick={onClose}
          className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold
            hover:bg-blue-700 active:scale-95 transition-all duration-150">
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Modal UI (rendered via Portal) ───────────────────────────────────────
function ModalContent({ f, handleClose, initialInquiryType }) {
  const renderStep = () => {
    if (f.step === 0) return <Step0 onSelect={f.selectInquiryType} />;
    if (f.inquiryType === "training") {
      return f.step === 1
        ? <TrainingStep1 {...f} initialInquiryType={initialInquiryType} />
        : <TrainingStep2 {...f} />;
    }
    return f.step === 1 ? <SolutionsStep1 {...f} /> : <SolutionsStep2 {...f} />;
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex justify-end px-7 pt-5">
          <button type="button" onClick={handleClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center
              justify-center text-gray-500 hover:text-gray-700 transition-colors duration-150">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-7 pb-7">
          {f.status === "success" ? (
            <SuccessScreen onClose={handleClose} reset={f.reset} />
          ) : (
            <>
              <ProgressBar step={f.step} />
              {renderStep()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ───────────────────────────────────────────────────────────
/**
 * @param {boolean}                    isOpen
 * @param {() => void}                 onClose
 * @param {number}                     [initialStep=0]
 * @param {"training"|"solutions"|null} [initialInquiryType=null]
 * @param {string|null}                [preselectedCourse=null]
 */
export default function InquireModal({
  isOpen,
  onClose,
  initialStep = 0,
  initialInquiryType = null,
  preselectedCourse = null,
}) {
  const f = useEnrollForm(onClose, initialStep, initialInquiryType, preselectedCourse);
  const navigate = useNavigate();
  const handleClose = useCallback(() => { f.reset(); onClose(); }, [f, onClose]);

  useEffect(() => {
    if (isOpen) f.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    if (f.status !== "success") return;

    handleClose();
    navigate("/", {
      state: { submissionMessage: "Message sent successfully!" },
    });
  }, [f.status, navigate, handleClose]);

  if (!isOpen) return null;

  return createPortal(
    <ModalContent f={f} handleClose={handleClose} initialInquiryType={initialInquiryType} />,
    document.body,
  );
}