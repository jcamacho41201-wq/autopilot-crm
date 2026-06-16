import { UserPlus } from "lucide-react";
import { createTechnicianAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function TeamPage() {
  const user = await requireUser();
  const technicians = await prisma.technician.findMany({
    where: { shopId: user.shopId },
    include: { appointments: true },
    orderBy: { name: "asc" }
  });

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Secondary workforce feature</p>
          <h1>Technicians</h1>
          <p>Track assignments, job counts, estimated hours, actual hours, and a simple efficiency score.</p>
        </div>
      </header>
      <section className="split">
        <div className="panel">
          <h2>Efficiency</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Technician</th><th>Role</th><th>Jobs</th><th>Standard hours</th><th>Actual hours</th><th>Efficiency</th></tr></thead>
              <tbody>
                {technicians.map((tech) => {
                  const scheduled = tech.appointments.reduce((sum, appointment) => sum + appointment.estimatedJobHours, tech.standardHours);
                  const actualFromJobs = tech.appointments.reduce((sum, appointment) => sum + (appointment.actualJobHours ?? appointment.estimatedJobHours), tech.actualHours);
                  const efficiency = actualFromJobs > 0 ? Math.round((scheduled / actualFromJobs) * 100) : 100;
                  return (
                    <tr key={tech.id}>
                      <td><strong>{tech.name}</strong></td>
                      <td>{tech.role}</td>
                      <td>{tech.jobsCompleted + tech.appointments.length}</td>
                      <td>{scheduled.toFixed(1)}</td>
                      <td>{actualFromJobs.toFixed(1)}</td>
                      <td><span className={`badge ${efficiency >= 100 ? "ok" : efficiency >= 85 ? "warn" : "danger"}`}>{efficiency}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="panel">
          <form className="form" action={createTechnicianAction}>
            <h2>Add Technician</h2>
            <label>Name<input name="name" required /></label>
            <label>Role<input name="role" defaultValue="Technician" /></label>
            <button className="button" type="submit"><UserPlus /> Add tech</button>
          </form>
        </aside>
      </section>
    </>
  );
}
