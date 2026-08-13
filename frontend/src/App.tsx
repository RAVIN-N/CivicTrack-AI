import { useCallback, useEffect, useState } from "react";

type ComplaintResult = {
  id: string;
  category: string;
  department: string;
  priority: string;
  confidence: number;
  sla: string;
  reason: string;
};

type StoredComplaint = ComplaintResult & {
  title: string;
  description: string;
  location: string;
  status: string;
  submittedAt: string;
  officerAction: string;
  slaDeadline: string;
  escalationStatus: "Not Escalated" | "Escalated";
  escalatedTo: string;
};

const getEscalationTarget = (department: string, category: string) => {
  const value = `${department} ${category}`.toLowerCase();

  if (
    value.includes("waste") ||
    value.includes("sanitation") ||
    value.includes("garbage")
  ) {
    return "Sanitation Supervisor";
  }

  if (
    value.includes("street light") ||
    value.includes("lighting") ||
    value.includes("electrical")
  ) {
    return "Street Lighting Supervisor";
  }

  if (
    value.includes("road") ||
    value.includes("pothole") ||
    value.includes("engineering")
  ) {
    return "Municipal Engineering Supervisor";
  }

  if (value.includes("water")) {
    return "Water Supply Supervisor";
  }

  return "Concerned Municipal Department Supervisor";
};

const normalizeComplaint = (rawComplaint: StoredComplaint): StoredComplaint => {
  const slaHours = Number.parseFloat(rawComplaint.sla) || 24;
  const submittedAt = rawComplaint.submittedAt || new Date().toISOString();
  const existingDeadline = rawComplaint.slaDeadline;
  const slaDeadline = existingDeadline
    ? existingDeadline
    : new Date(
        new Date(submittedAt).getTime() + slaHours * 60 * 60 * 1000
      ).toISOString();

  const isResolved = rawComplaint.status === "Resolved";
  const isOverdue = !isResolved && new Date(slaDeadline).getTime() <= Date.now();

  if (isOverdue) {
    return {
      ...rawComplaint,
      submittedAt,
      slaDeadline,
      status: "Escalated",
      escalationStatus: "Escalated",
      escalatedTo:
        rawComplaint.escalatedTo ||
        getEscalationTarget(rawComplaint.department, rawComplaint.category),
      officerAction: `Automatically escalated to ${
        rawComplaint.escalatedTo ||
        getEscalationTarget(rawComplaint.department, rawComplaint.category)
      } because the SLA deadline was exceeded.`,
    };
  }

  return {
    ...rawComplaint,
    submittedAt,
    slaDeadline,
    escalationStatus: rawComplaint.escalationStatus || "Not Escalated",
    escalatedTo: rawComplaint.escalatedTo || "Not escalated",
  };
};


function App() {
  const [showForm, setShowForm] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showTracking, setShowTracking] = useState(false);
  const [showOfficerDashboard, setShowOfficerDashboard] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  const [trackingId, setTrackingId] = useState("");
  const [trackedComplaint, setTrackedComplaint] =
    useState<StoredComplaint | null>(null);

  const [result, setResult] = useState<ComplaintResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [complaints, setComplaints] = useState<StoredComplaint[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const loadComplaints = useCallback(() => {
    const storedComplaints: StoredComplaint[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (key && key.startsWith("complaint_")) {
        const value = localStorage.getItem(key);

        if (value) {
          try {
            const rawComplaint = JSON.parse(value) as StoredComplaint;
            const normalizedComplaint = normalizeComplaint(rawComplaint);

            if (
              JSON.stringify(rawComplaint) !==
              JSON.stringify(normalizedComplaint)
            ) {
              localStorage.setItem(
                key,
                JSON.stringify(normalizedComplaint)
              );
            }

            storedComplaints.push(normalizedComplaint);
          } catch (error) {
            console.error("Invalid complaint data:", error);
          }
        }
      }
    }

    storedComplaints.sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() -
        new Date(a.submittedAt).getTime()
    );

    setComplaints(storedComplaints);
  }, []);

  useEffect(() => {
    loadComplaints();

    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
      loadComplaints();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [loadComplaints]);

  useEffect(() => {
    if (!trackedComplaint) return;

    const stored = localStorage.getItem(`complaint_${trackedComplaint.id}`);

    if (!stored) return;

    try {
      const refreshedComplaint = normalizeComplaint(
        JSON.parse(stored) as StoredComplaint
      );

      if (JSON.stringify(refreshedComplaint) !== JSON.stringify(trackedComplaint)) {
        setTrackedComplaint(refreshedComplaint);
      }
    } catch (error) {
      console.error("Unable to refresh tracked complaint:", error);
    }
  }, [currentTime, trackedComplaint]);

  const getRemainingTime = (deadline: string) => {
    const remaining = new Date(deadline).getTime() - currentTime;

    if (remaining <= 0) {
      return {
        isOverdue: true,
        text: "OVERDUE",
      };
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
      return {
        isOverdue: false,
        text: `${days}d ${hours}h ${minutes}m`,
      };
    }

    return {
      isOverdue: false,
      text: `${hours}h ${minutes}m ${seconds}s`,
    };
  };

  const submitComplaint = async () => {
    if (!title.trim() || !description.trim() || !location.trim()) {
      alert("Please fill in all complaint details.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        "http://localhost:5000/api/analyze-complaint",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            description,
            location,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Complaint analysis failed.");
      }

      const complaint: ComplaintResult = {
        id: data.complaintId,
        category: data.category,
        department: data.department,
        priority: data.priority,
        confidence: Number(data.confidence),
        sla: `${data.slaHours} Hours`,
        reason: data.reason || "AI analysis completed successfully.",
      };

      const submittedAt = new Date().toISOString();
      const slaHours = Number(data.slaHours) || 24;
      const slaDeadline = new Date(
        new Date(submittedAt).getTime() + slaHours * 60 * 60 * 1000
      ).toISOString();

      const storedComplaint: StoredComplaint = {
        ...complaint,
        title,
        description,
        location,
        status: "Submitted",
        submittedAt,
        slaDeadline,
        escalationStatus: "Not Escalated",
        escalatedTo: "Not escalated",
        officerAction: "Not assigned yet",
      };

      localStorage.setItem(
        `complaint_${complaint.id}`,
        JSON.stringify(storedComplaint)
      );
      loadComplaints();

      setResult(complaint);
      setShowForm(false);
      setShowResult(true);

      setTitle("");
      setDescription("");
      setLocation("");
    } catch (error) {
      console.error("Complaint submission error:", error);

      alert(
        "Unable to analyse complaint. Please make sure the backend is running on port 5000."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const trackComplaint = () => {
    const id = trackingId.trim().toUpperCase();

    if (!id) {
      alert("Please enter a Complaint ID.");
      return;
    }

    const storedComplaint = localStorage.getItem(`complaint_${id}`);

    if (!storedComplaint) {
      setTrackedComplaint(null);
      alert("Complaint not found. Please check the Complaint ID.");
      return;
    }

    try {
      const complaint: StoredComplaint = JSON.parse(storedComplaint);
      setTrackedComplaint(complaint);
    } catch (error) {
      console.error("Tracking error:", error);
      alert("Unable to read complaint information.");
    }
  };

  const closeResult = () => {
    setShowResult(false);
    setResult(null);
  };

  const closeTracking = () => {
    setShowTracking(false);
    setTrackingId("");
    setTrackedComplaint(null);
  };

  const updateComplaintStatus = (id: string, status: string) => {
    const key = `complaint_${id}`;
    const stored = localStorage.getItem(key);

    if (!stored) return;

    try {
      const complaint = JSON.parse(stored) as StoredComplaint;

      const updatedComplaint: StoredComplaint = {
        ...complaint,
        status,
        escalationStatus: complaint.escalationStatus || "Not Escalated",
        escalatedTo: complaint.escalatedTo || "Not escalated",
        officerAction:
          status === "Resolved"
            ? "Complaint resolved by municipal officer."
            : status === "In Progress"
              ? "Complaint is currently being handled by the concerned department."
              : complaint.officerAction,
      };

      localStorage.setItem(key, JSON.stringify(updatedComplaint));

      setComplaints((prev) =>
        prev.map((item) =>
          item.id === id ? updatedComplaint : item
        )
      );

      if (trackedComplaint?.id === id) {
        setTrackedComplaint(updatedComplaint);
      }
    } catch (error) {
      console.error("Unable to update complaint status:", error);
    }
  };

  return (
    <>
      {/* OFFICER DASHBOARD */}
      {showOfficerDashboard && (
        <div className="fixed inset-0 z-50 bg-slate-100 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-6">

            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  Officer Dashboard
                </h1>

                <p className="mt-1 text-slate-500">
                  Monitor and manage civic complaints
                </p>
              </div>

              <button
                onClick={() => setShowOfficerDashboard(false)}
                className="rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-700"
              >
                Back
              </button>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">

              <div className="rounded-xl bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">
                  Total Complaints
                </p>

                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {complaints.length}
                </p>
              </div>

              <div className="rounded-xl bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">
                  Pending
                </p>

                <p className="mt-2 text-3xl font-bold text-orange-500">
                  {complaints.filter((complaint) => complaint.status !== "Resolved").length}
                </p>
              </div>

              <div className="rounded-xl bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">
                  High Risk
                </p>

                <p className="mt-2 text-3xl font-bold text-red-500">
                  {complaints.filter(
                    (complaint) =>
                      complaint.priority === "HIGH" ||
                      complaint.priority === "CRITICAL"
                  ).length}
                </p>
              </div>

              <div className="rounded-xl bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">
                  Resolved
                </p>

                <p className="mt-2 text-3xl font-bold text-green-600">
                  {complaints.filter((complaint) => complaint.status === "Resolved").length}
                </p>
              </div>

              <div className="rounded-xl bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">
                  Escalated
                </p>

                <p className="mt-2 text-3xl font-bold text-red-600">
                  {complaints.filter((complaint) => complaint.status === "Escalated").length}
                </p>
              </div>

            </div>

            <div className="rounded-xl bg-white shadow-sm">

              <div className="border-b border-slate-200 p-5">
                <h2 className="text-xl font-bold text-slate-900">
                  Recent Complaints
                </h2>
              </div>

              <div className="overflow-x-auto">

                <table className="w-full text-left">

                  <thead className="bg-slate-50">
                    <tr>

                      <th className="px-5 py-4 text-sm font-semibold text-slate-600">
                        Complaint ID
                      </th>

                      <th className="px-5 py-4 text-sm font-semibold text-slate-600">
                        Category
                      </th>

                      <th className="px-5 py-4 text-sm font-semibold text-slate-600">
                        Department
                      </th>

                      <th className="px-5 py-4 text-sm font-semibold text-slate-600">
                        Priority
                      </th>

                      <th className="px-5 py-4 text-sm font-semibold text-slate-600">
                        Status
                      </th>

                      <th className="px-5 py-4 text-sm font-semibold text-slate-600">
                        SLA
                      </th>

                      <th className="px-5 py-4 text-sm font-semibold text-slate-600">
                        Action
                      </th>

                    </tr>
                  </thead>

                  <tbody>
  {complaints.map((complaint) => (
    <tr
      key={complaint.id}
      className="border-t border-slate-200"
    >
      <td className="px-5 py-4 font-semibold text-indigo-600">
        {complaint.id}
      </td>

      <td className="px-5 py-4">
        {complaint.category}
      </td>

      <td className="px-5 py-4">
        {complaint.department}
      </td>

      <td className="px-5 py-4">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            complaint.priority === "CRITICAL" || complaint.priority === "HIGH"
              ? "bg-red-100 text-red-600"
              : complaint.priority === "MEDIUM"
                ? "bg-orange-100 text-orange-600"
                : "bg-green-100 text-green-600"
          }`}
        >
          {complaint.priority}
        </span>
      </td>

      <td className="px-5 py-4">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            complaint.status === "Resolved"
              ? "bg-green-100 text-green-600"
              : complaint.status === "Escalated"
                ? "bg-red-100 text-red-700"
                : complaint.status === "In Progress"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-blue-100 text-blue-600"
          }`}
        >
          {complaint.status}
        </span>
      </td>

      <td className="px-5 py-4">
        {(() => {
          const remaining = getRemainingTime(complaint.slaDeadline);

          return (
            <div>
              <p
                className={`font-semibold ${
                  remaining.isOverdue
                    ? "text-red-600"
                    : "text-orange-600"
                }`}
              >
                {remaining.text}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                SLA: {complaint.sla}
              </p>
            </div>
          );
        })()}
      </td>

      <td className="px-5 py-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setTrackingId(complaint.id);
              setTrackedComplaint(complaint);
              setShowTracking(true);
            }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            View
          </button>

          {complaint.status !== "Resolved" && (
            <>
              {complaint.status !== "Escalated" && (
                <button
                  onClick={() => updateComplaintStatus(complaint.id, "In Progress")}
                  className="rounded-lg bg-yellow-500 px-3 py-2 text-sm font-semibold text-white hover:bg-yellow-600"
                >
                  In Progress
                </button>
              )}

              <button
                onClick={() => updateComplaintStatus(complaint.id, "Resolved")}
                className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                Resolve
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  ))}
</tbody>
                </table>

              </div>

            </div>

          </div>
        </div>
      )}

      <div className="min-h-screen bg-slate-50 text-slate-900">

        {/* NAVBAR */}
        <header className="border-b border-slate-200 bg-white">

          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">

            <div>
              <h1 className="text-2xl font-bold text-indigo-700">
                CivicTrack AI
              </h1>

              <p className="text-xs text-slate-500">
                Predict delays. Escalate early. Resolve transparently.
              </p>
            </div>

            <div className="flex items-center gap-3">

              <button
                onClick={() => setShowTracking(true)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Track Complaint
              </button>

              <button
                onClick={() => {
                  loadComplaints();
                  setShowOfficerDashboard(true);
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Officer Login
              </button>

            </div>
          </div>

        </header>

        {/* HERO */}
        <main>

          <section className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-2 lg:items-center">

            {/* LEFT */}
            <div>

              <div className="mb-5 inline-flex rounded-full bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700">
                AI-powered civic complaint management
              </div>

              <h2 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                Your complaint.
                <br />

                <span className="text-indigo-600">
                  Tracked until resolution.
                </span>
              </h2>

              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
                Submit a civic complaint and let AI identify the right
                department, calculate the SLA, detect delay risks and escalate
                unresolved complaints before they are forgotten.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">

                <button
                  onClick={() => setShowForm(true)}
                  className="rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  Submit a Complaint
                </button>

                <button
                  onClick={() => setShowTracking(true)}
                  className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Track Complaint
                </button>

              </div>
            </div>

            {/* AI ANALYSIS CARD */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">

              <div className="mb-6 flex items-center justify-between">

                <div>
                  <p className="text-sm font-medium text-slate-500">
                    Live Complaint Analysis
                  </p>

                  <h3 className="mt-1 text-xl font-bold">
                    {result ? result.id : "CT-1024"}
                  </h3>
                </div>

                <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-600">
                  {result ? result.priority : "High Risk"}
                </span>

              </div>

              <div className="rounded-2xl bg-slate-50 p-4">

                <p className="text-sm text-slate-500">
                  Complaint
                </p>

                <p className="mt-2 font-medium">
                  {result
                    ? "Latest complaint analysed by CivicTrack AI."
                    : "“Garbage has not been collected in our street for 3 days.”"}
                </p>

              </div>

              <div className="mt-6 grid grid-cols-2 gap-4">

                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">
                    AI Category
                  </p>

                  <p className="mt-1 font-semibold">
                    {result ? result.category : "Garbage Collection"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">
                    Department
                  </p>

                  <p className="mt-1 font-semibold">
                    {result ? result.department : "Sanitation"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">
                    SLA
                  </p>

                  <p className="mt-1 font-semibold text-orange-600">
                    {result ? result.sla : "06h 42m"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">
                    AI Confidence
                  </p>

                  <p className="mt-1 font-semibold text-red-600">
                    {result ? `${result.confidence}%` : "87%"}
                  </p>
                </div>

              </div>

              <div className="mt-6 rounded-2xl bg-red-50 p-4">

                <p className="font-semibold text-red-700">
                  ⚠ SLA Violation Risk Detection
                </p>

                <p className="mt-1 text-sm text-red-600">
                  {result
                    ? result.reason
                    : "AI monitors complaint priority and SLA risk."}
                </p>

              </div>

            </div>

          </section>

          {/* WORKFLOW */}
          <section className="border-t border-slate-200 bg-white">

            <div className="mx-auto max-w-7xl px-6 py-14">

              <div className="text-center">

                <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">
                  How CivicTrack AI works
                </p>

                <h3 className="mt-2 text-3xl font-bold">
                  From complaint to resolution
                </h3>

              </div>

              <div className="mt-10 grid gap-6 md:grid-cols-4">

                {[
                  {
                    number: "01",
                    title: "Submit",
                    text: "Citizen submits a complaint with relevant details.",
                  },
                  {
                    number: "02",
                    title: "Classify",
                    text: "AI identifies the category and correct department.",
                  },
                  {
                    number: "03",
                    title: "Monitor",
                    text: "SLA and delay risk are continuously monitored.",
                  },
                  {
                    number: "04",
                    title: "Escalate",
                    text: "High-risk and overdue complaints are escalated.",
                  },
                ].map((item) => (

                  <div
                    key={item.number}
                    className="rounded-2xl border border-slate-200 p-6"
                  >

                    <div className="text-2xl font-bold text-indigo-600">
                      {item.number}
                    </div>

                    <h4 className="mt-4 text-lg font-bold">
                      {item.title}
                    </h4>

                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {item.text}
                    </p>

                  </div>

                ))}

              </div>

            </div>

          </section>

        </main>

        {/* COMPLAINT FORM */}
        {showForm && (

          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">

            <div className="w-full max-w-2xl rounded-3xl bg-white p-8 shadow-2xl">

              <div className="flex items-center justify-between">

                <div>
                  <h2 className="text-2xl font-bold">
                    Submit a Complaint
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Provide the details of your civic issue.
                  </p>
                </div>

                <button
                  onClick={() => setShowForm(false)}
                  className="rounded-full px-3 py-2 text-xl text-slate-500 hover:bg-slate-100"
                >
                  ×
                </button>

              </div>

              <div className="mt-7 space-y-5">

                {/* TITLE */}
                <div>

                  <label className="mb-2 block text-sm font-semibold">
                    Complaint Title
                  </label>

                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Example: Garbage not collected"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />

                </div>

                {/* DESCRIPTION */}
                <div>

                  <label className="mb-2 block text-sm font-semibold">
                    Describe your problem
                  </label>

                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                    placeholder="Explain your civic issue..."
                    className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />

                </div>

                {/* LOCATION */}
                <div>

                  <label className="mb-2 block text-sm font-semibold">
                    Location
                  </label>

                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Example: Gandhipuram, Coimbatore"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />

                </div>

                {/* AI INFO */}
                <div className="rounded-2xl bg-indigo-50 p-4">

                  <p className="font-semibold text-indigo-700">
                    ✨ AI Analysis
                  </p>

                  <p className="mt-1 text-sm text-indigo-600">
                    CivicTrack AI will analyse your complaint and identify the
                    appropriate department, priority and SLA.
                  </p>

                </div>

                {/* SUBMIT */}
                <button
                  onClick={submitComplaint}
                  disabled={isSubmitting}
                  className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting
                    ? "Analysing with AI..."
                    : "Analyse & Submit Complaint"}
                </button>

              </div>

            </div>

          </div>

        )}

        {/* RESULT MODAL */}
        {showResult && result && (

          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">

            <div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl">

              <div className="text-center">

                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
                  ✓
                </div>

                <h2 className="mt-5 text-2xl font-bold">
                  Complaint Submitted
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Gemini AI successfully analysed your complaint.
                </p>

              </div>

              <div className="mt-7 rounded-2xl bg-slate-50 p-5">

                <p className="text-sm text-slate-500">
                  Complaint ID
                </p>

                <p className="mt-1 text-2xl font-bold text-indigo-600">
                  {result.id}
                </p>

              </div>

              <div className="mt-5 grid grid-cols-2 gap-4">

                <div className="rounded-xl border border-slate-200 p-4">

                  <p className="text-xs text-slate-500">
                    Category
                  </p>

                  <p className="mt-1 font-semibold">
                    {result.category}
                  </p>

                </div>

                <div className="rounded-xl border border-slate-200 p-4">

                  <p className="text-xs text-slate-500">
                    Department
                  </p>

                  <p className="mt-1 font-semibold">
                    {result.department}
                  </p>

                </div>

                <div className="rounded-xl border border-slate-200 p-4">

                  <p className="text-xs text-slate-500">
                    Priority
                  </p>

                  <p className="mt-1 font-semibold text-red-600">
                    {result.priority}
                  </p>

                </div>

                <div className="rounded-xl border border-slate-200 p-4">

                  <p className="text-xs text-slate-500">
                    SLA
                  </p>

                  <p className="mt-1 font-semibold">
                    {result.sla}
                  </p>

                </div>

              </div>

              <div className="mt-5 rounded-xl bg-emerald-50 p-4">

                <p className="font-semibold text-emerald-700">
                  AI Confidence: {result.confidence}%
                </p>

                <p className="mt-2 text-sm text-emerald-700">
                  {result.reason}
                </p>

              </div>

              <button
                onClick={closeResult}
                className="mt-6 w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700"
              >
                Done
              </button>

            </div>

          </div>

        )}

        {/* TRACK COMPLAINT MODAL */}
        {showTracking && (

          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">

            <div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl">

              <div className="flex items-center justify-between">

                <div>
                  <h2 className="text-2xl font-bold">
                    Track Complaint
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Enter your complaint ID to view its status.
                  </p>
                </div>

                <button
                  onClick={closeTracking}
                  className="rounded-full px-3 py-2 text-xl text-slate-500 hover:bg-slate-100"
                >
                  ×
                </button>

              </div>

              <div className="mt-7">

                <label className="mb-2 block text-sm font-semibold">
                  Complaint ID
                </label>

                <div className="flex gap-3">

                  <input
                    value={trackingId}
                    onChange={(e) => setTrackingId(e.target.value)}
                    placeholder="Example: CT-3151"
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500"
                  />

                  <button
                    onClick={trackComplaint}
                    className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700"
                  >
                    Track
                  </button>

                </div>

              </div>

              {trackedComplaint && (

                <div className="mt-7 space-y-4">
                  {/* COMPLAINT TITLE */}
<div className="rounded-2xl bg-white border border-slate-200 p-5">
  <p className="text-xs text-slate-500">Complaint Title</p>

  <p className="mt-1 text-lg font-semibold text-slate-900">
    {trackedComplaint.title}
  </p>
</div>

                  <div className="rounded-2xl bg-slate-50 p-5">

                    <p className="text-sm text-slate-500">
                      Complaint ID
                    </p>

                    <p className="mt-1 text-2xl font-bold text-indigo-600">
                      {trackedComplaint.id}
                    </p>

                  </div>

                  <div className="grid grid-cols-2 gap-4">

                    <div className="rounded-xl border border-slate-200 p-4">

                      <p className="text-xs text-slate-500">
                        Category
                      </p>

                      <p className="mt-1 font-semibold">
                        {trackedComplaint.category}
                      </p>

                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">

                      <p className="text-xs text-slate-500">
                        Department
                      </p>

                      <p className="mt-1 font-semibold">
                        {trackedComplaint.department}
                      </p>

                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">

                      <p className="text-xs text-slate-500">
                        Priority
                      </p>

                      <p className="mt-1 font-semibold text-red-600">
                        {trackedComplaint.priority}
                      </p>

                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">

                      <p className="text-xs text-slate-500">
                        SLA
                      </p>

                      <p className="mt-1 font-semibold">
                        {trackedComplaint.sla}
                      </p>

                    </div>

                  </div>

                  <div className="rounded-2xl bg-indigo-50 p-5">

                    <p className="text-sm text-indigo-600">
                      Current Status
                    </p>

                    <p className="mt-1 text-lg font-bold text-indigo-700">
                      {trackedComplaint.status}
                    </p>

                    <p className="mt-2 text-sm text-slate-600">
                      {trackedComplaint.status === "Resolved"
                        ? "Your complaint has been resolved by the concerned department."
                        : trackedComplaint.status === "Escalated"
                          ? `Your complaint exceeded its SLA and was escalated to ${trackedComplaint.escalatedTo}.`
                          : trackedComplaint.status === "In Progress"
                            ? "Your complaint is currently being handled by the concerned department."
                            : "Your complaint has been registered and is waiting for officer action."}
                    </p>

                    {trackedComplaint.status !== "Resolved" && (
                      <div className={`mt-4 rounded-xl p-4 ${
                        getRemainingTime(trackedComplaint.slaDeadline).isOverdue
                          ? "bg-red-50"
                          : "bg-orange-50"
                      }`}>
                        <p
                          className={`text-sm font-semibold ${
                            getRemainingTime(trackedComplaint.slaDeadline).isOverdue
                              ? "text-red-700"
                              : "text-orange-700"
                          }`}
                        >
                          {getRemainingTime(trackedComplaint.slaDeadline).isOverdue
                            ? "⚠ SLA OVERDUE"
                            : `SLA Remaining: ${getRemainingTime(trackedComplaint.slaDeadline).text}`}
                        </p>

                        {trackedComplaint.status === "Escalated" && (
                          <p className="mt-2 text-sm text-red-700">
                            Escalated to: {trackedComplaint.escalatedTo}
                          </p>
                        )}
                      </div>
                    )}

                  </div>

                </div>

              )}

            </div>

          </div>

        )}

      </div>
    </>
  );
}

export default App;