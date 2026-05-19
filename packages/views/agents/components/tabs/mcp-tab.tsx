"use client";

import { useEffect, useState } from "react";
import { Globe, Loader2, Plus, Save, Terminal, Trash2 } from "lucide-react";
import type { Agent } from "@multica/core/types";
import { createSafeId } from "@multica/core/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { toast } from "sonner";
import { useT } from "../../../i18n";

// Stdio transport server config
interface StdioServerConfig {
  type: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// HTTP/SSE transport server config
interface HttpServerConfig {
  type: string;
  url: string;
  headers?: Record<string, string>;
}

type McpServerConfig = StdioServerConfig | HttpServerConfig;

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

type TransportType = "stdio" | "http";

interface ServerEntry {
  id: string;
  name: string;
  transportType: TransportType;
  // stdio fields
  command: string;
  args: string;
  envVars: { key: string; value: string }[];
  // http fields
  url: string;
  headers: { key: string; value: string }[];
}

function isStdioConfig(config: McpServerConfig): config is StdioServerConfig {
  return "command" in config;
}

function isHttpConfig(config: McpServerConfig): config is HttpServerConfig {
  return "url" in config;
}

function parseMcpConfig(raw: unknown): McpConfig {
  if (raw && typeof raw === "object") {
    return raw as McpConfig;
  }
  return {};
}

function configToEntries(config: McpConfig): ServerEntry[] {
  const servers = config.mcpServers ?? {};
  return Object.entries(servers).map(([name, server]) => {
    if (isHttpConfig(server)) {
      return {
        id: createSafeId(),
        name,
        transportType: "http" as TransportType,
        command: "",
        args: "",
        envVars: [],
        url: server.url,
        headers: Object.entries(server.headers ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      };
    }
    return {
      id: createSafeId(),
      name,
      transportType: "stdio" as TransportType,
      command: server.command,
      args: server.args?.join(" ") ?? "",
      envVars: Object.entries(server.env ?? {}).map(([key, value]) => ({
        key,
        value,
      })),
      url: "",
      headers: [],
    };
  });
}

function entriesToConfig(entries: ServerEntry[]): McpConfig {
  const servers: Record<string, McpServerConfig> = {};
  for (const entry of entries) {
    if (!entry.name.trim()) continue;
    if (entry.transportType === "http") {
      const headers: Record<string, string> = {};
      for (const { key, value } of entry.headers) {
        if (key.trim()) {
          headers[key.trim()] = value;
        }
      }
      servers[entry.name.trim()] = {
        type: "http",
        url: entry.url,
        ...(Object.keys(headers).length > 0 && { headers }),
      };
    } else {
      const args = entry.args
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const env: Record<string, string> = {};
      for (const { key, value } of entry.envVars) {
        if (key.trim()) {
          env[key.trim()] = value;
        }
      }
      servers[entry.name.trim()] = {
        type: "stdio",
        command: entry.command,
        ...(args.length > 0 && { args }),
        ...(Object.keys(env).length > 0 && { env }),
      };
    }
  }
  return { mcpServers: Object.keys(servers).length > 0 ? servers : undefined };
}

function sortObjectKeys<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj), (_key, value) =>
    Array.isArray(value) ? value : value && typeof value === "object" ? Object.keys(value).sort().reduce((acc, k) => ({ ...acc, [k]: (value as Record<string, unknown>)[k] }), {}) : value
  ) as T;
}

function configEquals(a: McpConfig, b: McpConfig): boolean {
  return JSON.stringify(sortObjectKeys(a)) === JSON.stringify(sortObjectKeys(b));
}

export function McpTab({
  agent,
  onSave,
  onDirtyChange,
}: {
  agent: Agent;
  onSave: (updates: Partial<Agent>) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useT("agents");
  const [entries, setEntries] = useState<ServerEntry[]>(() =>
    configToEntries(parseMcpConfig(agent.mcp_config)),
  );
  const [saving, setSaving] = useState(false);

  const currentConfig = entriesToConfig(entries);
  const originalConfig = parseMcpConfig(agent.mcp_config);
  const dirty = !configEquals(currentConfig, originalConfig);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setEntries(configToEntries(parseMcpConfig(agent.mcp_config)));
  }, [agent.mcp_config]);

  const addEntry = () => {
    setEntries([
      ...entries,
      {
        id: createSafeId(),
        name: "",
        transportType: "stdio",
        command: "",
        args: "",
        envVars: [],
        url: "",
        headers: [],
      },
    ]);
  };

  const removeEntry = (id: string) => {
    setEntries(entries.filter((e) => e.id !== id));
  };

  const updateEntry = (id: string, field: keyof ServerEntry, value: unknown) => {
    setEntries(
      entries.map((e) => {
        if (e.id !== id) return e;
        const updated = { ...e, [field]: value };
        // When switching transport type, reset fields
        if (field === "transportType") {
          if (value === "http") {
            updated.command = "";
            updated.args = "";
            updated.envVars = [];
          } else {
            updated.url = "";
            updated.headers = [];
          }
        }
        return updated;
      }),
    );
  };

  const addEnvVar = (id: string) => {
    setEntries(
      entries.map((e) =>
        e.id === id
          ? { ...e, envVars: [...e.envVars, { key: "", value: "" }] }
          : e,
      ),
    );
  };

  const removeEnvVar = (entryId: string, index: number) => {
    setEntries(
      entries.map((e) =>
        e.id === entryId
          ? { ...e, envVars: e.envVars.filter((_, i) => i !== index) }
          : e,
      ),
    );
  };

  const updateEnvVar = (
    entryId: string,
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    setEntries(
      entries.map((e) =>
        e.id === entryId
          ? {
              ...e,
              envVars: e.envVars.map((ev, i) =>
                i === index ? { ...ev, [field]: value } : ev,
              ),
            }
          : e,
      ),
    );
  };

  const addHeader = (id: string) => {
    setEntries(
      entries.map((e) =>
        e.id === id
          ? { ...e, headers: [...e.headers, { key: "", value: "" }] }
          : e,
      ),
    );
  };

  const removeHeader = (entryId: string, index: number) => {
    setEntries(
      entries.map((e) =>
        e.id === entryId
          ? { ...e, headers: e.headers.filter((_, i) => i !== index) }
          : e,
      ),
    );
  };

  const updateHeader = (
    entryId: string,
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    setEntries(
      entries.map((e) =>
        e.id === entryId
          ? {
              ...e,
              headers: e.headers.map((h: { key: string; value: string }, i: number) =>
                i === index ? { ...h, [field]: value } : h,
              ),
            }
          : e,
      ),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ mcp_config: currentConfig });
      toast.success(t(($) => $.tab_body.mcp.saved_toast));
    } catch {
      toast.error(t(($) => $.tab_body.mcp.save_failed_toast));
    } finally {
      setSaving(false);
    }
  };

  if (agent.mcp_config_redacted) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <Globe className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t(($) => $.tab_body.mcp.redacted_title)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.tab_body.mcp.redacted_description)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {t(($) => $.tab_body.mcp.intro)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.tab_body.mcp.intro_claude_code_only)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addEntry}
          className="shrink-0"
        >
          <Plus className="h-3 w-3" />
          {t(($) => $.tab_body.common.add)}
        </Button>
      </div>

      {entries.length > 0 && (
        <div className="space-y-6">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="space-y-3 rounded-lg border p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t(($) => $.tab_body.mcp.server)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeEntry(entry.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t(($) => $.tab_body.mcp.remove_server_aria)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Server name - common to all transport types */}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t(($) => $.tab_body.mcp.server_name_label)}
                </Label>
                <Input
                  value={entry.name}
                  onChange={(e) => updateEntry(entry.id, "name", e.target.value)}
                  placeholder={t(($) => $.tab_body.mcp.server_name_placeholder)}
                  className="font-mono text-xs"
                />
              </div>

              {/* Transport type selector */}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t(($) => $.tab_body.mcp.transport_type_label)}
                </Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => updateEntry(entry.id, "transportType", "stdio")}
                    className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                      entry.transportType === "stdio"
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    {t(($) => $.tab_body.mcp.transport_stdio)}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateEntry(entry.id, "transportType", "http")}
                    className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                      entry.transportType === "http"
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {t(($) => $.tab_body.mcp.transport_http)}
                  </button>
                </div>
              </div>

              {/* Stdio transport fields */}
              {entry.transportType === "stdio" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {t(($) => $.tab_body.mcp.command_label)}
                      </Label>
                      <Input
                        value={entry.command}
                        onChange={(e) => updateEntry(entry.id, "command", e.target.value)}
                        placeholder={t(($) => $.tab_body.mcp.command_placeholder)}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {t(($) => $.tab_body.mcp.args_label)}
                      </Label>
                      <Input
                        value={entry.args}
                        onChange={(e) => updateEntry(entry.id, "args", e.target.value)}
                        placeholder={t(($) => $.tab_body.mcp.args_placeholder)}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">
                        {t(($) => $.tab_body.mcp.env_label)}
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => addEnvVar(entry.id)}
                        className="h-6 text-xs"
                      >
                        <Plus className="h-3 w-3" />
                        {t(($) => $.tab_body.mcp.add_env)}
                      </Button>
                    </div>
                    {entry.envVars.length > 0 && (
                      <div className="space-y-1.5">
                        {entry.envVars.map((ev, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              value={ev.key}
                              onChange={(e) =>
                                updateEnvVar(entry.id, index, "key", e.target.value)
                              }
                              placeholder={t(($) => $.tab_body.mcp.env_key_placeholder)}
                              className="flex-1 font-mono text-xs"
                            />
                            <span className="text-xs text-muted-foreground">=</span>
                            <Input
                              value={ev.value}
                              onChange={(e) =>
                                updateEnvVar(entry.id, index, "value", e.target.value)
                              }
                              placeholder={t(($) => $.tab_body.mcp.env_value_placeholder)}
                              className="flex-1 font-mono text-xs"
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeEnvVar(entry.id, index)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* HTTP transport fields */}
              {entry.transportType === "http" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {t(($) => $.tab_body.mcp.url_label)}
                    </Label>
                    <Input
                      value={entry.url}
                      onChange={(e) => updateEntry(entry.id, "url", e.target.value)}
                      placeholder={t(($) => $.tab_body.mcp.url_placeholder)}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">
                        {t(($) => $.tab_body.mcp.headers_label)}
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => addHeader(entry.id)}
                        className="h-6 text-xs"
                      >
                        <Plus className="h-3 w-3" />
                        {t(($) => $.tab_body.mcp.add_header)}
                      </Button>
                    </div>
                    {entry.headers.length > 0 && (
                      <div className="space-y-1.5">
                        {entry.headers.map((header, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              value={header.key}
                              onChange={(e) =>
                                updateHeader(entry.id, index, "key", e.target.value)
                              }
                              placeholder={t(($) => $.tab_body.mcp.header_key_placeholder)}
                              className="flex-1 font-mono text-xs"
                            />
                            <span className="text-xs text-muted-foreground">=</span>
                            <Input
                              value={header.value}
                              onChange={(e) =>
                                updateHeader(entry.id, index, "value", e.target.value)
                              }
                              placeholder={t(($) => $.tab_body.mcp.header_value_placeholder)}
                              className="flex-1 font-mono text-xs"
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeHeader(entry.id, index)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {dirty && (
          <span className="text-xs text-muted-foreground">
            {t(($) => $.tab_body.common.unsaved_changes)}
          </span>
        )}
        <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t(($) => $.tab_body.common.save)}
        </Button>
      </div>
    </div>
  );
}