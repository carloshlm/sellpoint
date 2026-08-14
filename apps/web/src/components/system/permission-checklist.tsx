import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { PermissionGroup } from "@/lib/rbac/api";

interface PermissionChecklistProps {
  groups: PermissionGroup[];
  /**
   * `role.permissionCodes` TAL COMO VINO DEL BACKEND (antes de cualquier
   * toggle en esta sesión de edición) — es contra ESTO que
   * `assertNoPrivilegeEscalation` calcula el delta agregado, no contra el
   * estado actual del checklist.
   */
  baselinePermissionCodes: string[];
  /** Permisos del ACTOR (no del rol editado) — alimenta D5. */
  actorPermissionCodes: string[];
  /** Set de codes actualmente marcados. Controlado por el container. */
  selected: Set<string>;
  /** Emite el CODE (nunca un índice) — riesgo #1 del proposal. */
  onToggle: (code: string, checked: boolean) => void;
  /** Sin `roles:manage`: todo el checklist es de solo lectura. */
  readOnly?: boolean;
}

/**
 * F1-WEB-USERS-05 (WU6). Presentacional puro: `Set<string>` de CÓDIGOS,
 * agrupado por módulo (D4). Disabled ASIMÉTRICO (D5):
 * `!actor.has(code) && !baseline.includes(code)` — un permiso que el actor no
 * posee se puede QUITAR (ya estaba en el rol) pero no AGREGAR, porque
 * `assertNoPrivilegeEscalation` solo valida el delta AGREGADO.
 */
function PermissionChecklist({
  groups,
  baselinePermissionCodes,
  actorPermissionCodes,
  selected,
  onToggle,
  readOnly = false,
}: PermissionChecklistProps) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <fieldset key={group.module} className="flex flex-col gap-2">
          <legend className="text-sm font-medium capitalize">{group.module}</legend>
          <div className="flex flex-col gap-2">
            {group.permissions.map((permission) => {
              const checked = selected.has(permission.code);
              const canAdd =
                actorPermissionCodes.includes(permission.code) ||
                baselinePermissionCodes.includes(permission.code);
              const disabled = readOnly || !canAdd;
              const inputId = `permission-${permission.code}`;
              return (
                <div key={permission.code} className="flex items-center gap-2">
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) => onToggle(permission.code, next === true)}
                  />
                  <Label
                    htmlFor={inputId}
                    className={disabled ? "text-muted-foreground" : undefined}
                  >
                    {permission.code}
                  </Label>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export { PermissionChecklist };
