import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { UsuariosView } from './UsuariosView';

export const dynamic = 'force-dynamic';

/**
 * Quién tiene acceso a la finca (capacidad `usuarios`).
 *
 * Las dos listas van juntas —quiénes están y a quiénes se invitó— porque son la misma pregunta
 * vista en dos momentos, y separarlas obligaría a mirar en dos lados para saber cuánta gente hay.
 *
 * Si la API devuelve 403 la pantalla no existe para ese rol: `apiSafe` da `null` y se muestra el
 * cartel en vez de romper. La autorización de verdad la hace el backend; esto solo evita una
 * pantalla vacía sin explicación.
 */
export default async function UsuariosPage() {
  const [members, invitations] = await Promise.all([
    apiSafe<any[]>('/members'),
    apiSafe<any[]>('/invitations'),
  ]);

  if (members === null) {
    return (
      <EmptyState
        title="No podés administrar usuarios"
        body="Solo el propietario y el administrador pueden invitar y quitar gente. Si creés que es un error, pedile acceso a quien administra la finca."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Usuarios</h1>
        <p className="mt-0.5 text-body text-ink-3">
          Sumá a tu veterinario, tu capataz o tu contador. Cada uno entra con su propia cuenta y ve
          solo lo que su rol necesita.
        </p>
      </div>
      <UsuariosView members={members} invitations={invitations ?? []} />
    </div>
  );
}
