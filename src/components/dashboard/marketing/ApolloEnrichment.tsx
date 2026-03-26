import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Upload,
  Download,
  Search,
  Zap,
  AlertCircle,
  CheckCircle,
  Send,
  FileSpreadsheet,
  FileText,
  Trash2,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import Papa from "papaparse";

// ─── Types ───
interface ApolloContact {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string;
  phone: string;
  linkedin_url: string;
  company_name: string;
  company_domain: string;
  company_industry: string;
  company_size: string;
  city: string;
  country: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
}

// ─── Position presets ───
const POSITION_PRESETS = [
  "CEO",
  "CTO",
  "CFO",
  "COO",
  "Managing Director",
  "Founder",
  "Co-Founder",
  "VP of Sales",
  "VP of Engineering",
  "VP of Operations",
  "Sales Director",
  "Head of Procurement",
  "Head of Sales",
  "Head of Engineering",
  "Purchasing Manager",
  "Operations Manager",
  "Supply Chain Manager",
  "Production Manager",
  "Plant Manager",
  "General Manager",
  "Business Development Manager",
  "Technical Director",
  "Engineering Manager",
  "Quality Manager",
];

export default function ApolloEnrichment() {
  const [companiesText, setCompaniesText] = useState("");
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [contacts, setContacts] = useState<ApolloContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchErrors, setSearchErrors] = useState<string[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [sendingToCampaign, setSendingToCampaign] = useState(false);

  // Check API key on mount
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "apollo_api_key")
        .single();
      setHasApiKey(!!data?.value);
    })();
  }, []);

  // Load campaigns for send-to-campaign feature
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("marketing_campaigns")
        .select("id, name, status")
        .order("created_at", { ascending: false });
      setCampaigns((data as Campaign[]) || []);
    })();
  }, []);

  const toggleTitle = (title: string) => {
    setSelectedTitles((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const addCustomTitle = () => {
    if (customTitle.trim() && !selectedTitles.includes(customTitle.trim())) {
      setSelectedTitles((prev) => [...prev, customTitle.trim()]);
      setCustomTitle("");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith(".csv")) {
      Papa.parse(file, {
        complete: (result) => {
          const companies = result.data
            .flat()
            .map((v: any) => String(v || "").trim())
            .filter(Boolean);
          setCompaniesText((prev) => (prev ? prev + "\n" : "") + companies.join("\n"));
        },
      });
    } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const wb = XLSX.read(evt.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        const companies = data
          .flat()
          .map((v: any) => String(v || "").trim())
          .filter(Boolean);
        setCompaniesText((prev) => (prev ? prev + "\n" : "") + companies.join("\n"));
      };
      reader.readAsBinaryString(file);
    }
    e.target.value = "";
  };

  const handleEnrich = async () => {
    const companies = companiesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!companies.length) {
      setError("Enter at least one company name or domain.");
      return;
    }
    if (!selectedTitles.length) {
      setError("Select at least one position/title to search for.");
      return;
    }

    setLoading(true);
    setError("");
    setSearchErrors([]);
    setContacts([]);
    setSelectedContactIds(new Set());

    try {
      const resp = await fetch("/api/apollo-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies, titles: selectedTitles }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.error || "Enrichment failed.");
        return;
      }

      setContacts(data.contacts || []);
      if (data.errors?.length) setSearchErrors(data.errors);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  // ─── Selection ───
  const toggleContactSelection = (id: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedContactIds.size === contacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(contacts.map((c) => c.id)));
    }
  };

  const getExportData = () => {
    const rows = selectedContactIds.size > 0
      ? contacts.filter((c) => selectedContactIds.has(c.id))
      : contacts;
    return rows;
  };

  // ─── Excel export ───
  const handleExportExcel = () => {
    const rows = getExportData().map((c) => ({
      Name: c.name,
      Title: c.title,
      Email: c.email,
      "Email Status": c.email_status,
      Phone: c.phone,
      LinkedIn: c.linkedin_url,
      Company: c.company_name,
      Domain: c.company_domain,
      Industry: c.company_industry,
      City: c.city,
      Country: c.country,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 25 }, { wch: 30 }, { wch: 35 }, { wch: 12 },
      { wch: 18 }, { wch: 40 }, { wch: 30 }, { wch: 25 },
      { wch: 20 }, { wch: 15 }, { wch: 15 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    XLSX.writeFile(wb, `apollo-contacts-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ─── CSV export ───
  const handleExportCsv = () => {
    const rows = getExportData();
    const csv = Papa.unparse(
      rows.map((c) => ({
        Name: c.name,
        Title: c.title,
        Email: c.email,
        "Email Status": c.email_status,
        Phone: c.phone,
        LinkedIn: c.linkedin_url,
        Company: c.company_name,
        Domain: c.company_domain,
        Industry: c.company_industry,
        City: c.city,
        Country: c.country,
      }))
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apollo-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Send to campaign ───
  const handleSendToCampaign = async () => {
    if (!selectedCampaignId) return;
    setSendingToCampaign(true);

    const contactsToSend = getExportData().filter((c) => c.email);

    try {
      // Step 1: Upsert contacts as marketing_subscribers
      const subscriberRecords = contactsToSend.map((c) => ({
        email: c.email,
        name: c.name,
        tags: [c.company_name, c.title, "apollo-enrichment"].filter(Boolean),
        status: "active",
      }));

      const { data: upserted, error: subErr } = await supabase
        .from("marketing_subscribers")
        .upsert(subscriberRecords, { onConflict: "email", ignoreDuplicates: false })
        .select("id, email");

      if (subErr) {
        setError(`Failed to create subscribers: ${subErr.message}`);
        setSendingToCampaign(false);
        return;
      }

      // Step 2: Create campaign recipients
      if (upserted && upserted.length > 0) {
        const recipientRecords = upserted.map((sub) => ({
          campaign_id: selectedCampaignId,
          subscriber_id: sub.id,
          status: "pending",
          sequence_number: 1,
          delay_days: 0,
        }));

        const { error: recErr } = await supabase
          .from("marketing_campaign_recipients")
          .upsert(recipientRecords, { onConflict: "campaign_id,subscriber_id", ignoreDuplicates: true });

        if (recErr) {
          setError(`Subscribers created but failed to add to campaign: ${recErr.message}`);
        }
      }
    } catch (err: any) {
      setError(err.message);
    }

    setSendingToCampaign(false);
    setCampaignDialogOpen(false);
  };

  // ─── No API key warning ───
  if (hasApiKey === false) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-yellow-500" />
          <h3 className="text-lg font-semibold mb-2">Apollo.io API Key Required</h3>
          <p className="text-muted-foreground mb-4">
            To use Apollo enrichment, add your API key in Settings &gt; Integrations.
          </p>
          <Button variant="outline" onClick={() => window.location.href = "/dashboard/email-marketing/settings"}>
            Go to Settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Input section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Companies input */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-orange-500" />
              Companies to Enrich
            </CardTitle>
            <CardDescription>Enter company names or domains, one per line. Or upload a CSV/Excel file.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={companiesText}
              onChange={(e) => setCompaniesText(e.target.value)}
              placeholder={"acme-corp.com\nSiemens\nbosch.com\nTrumpf GmbH\n..."}
              rows={8}
              className="font-mono text-sm"
            />
            <div className="flex gap-2">
              <label className="cursor-pointer">
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                <Button variant="outline" size="sm" className="gap-1 pointer-events-none" tabIndex={-1}>
                  <Upload className="h-3.5 w-3.5" />
                  Upload CSV/Excel
                </Button>
              </label>
              {companiesText && (
                <Badge variant="outline" className="self-center">
                  {companiesText.split("\n").filter((s) => s.trim()).length} companies
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Title/position selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              Positions to Search
            </CardTitle>
            <CardDescription>Select job titles/positions to look for at each company.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {POSITION_PRESETS.map((title) => (
                <Badge
                  key={title}
                  variant={selectedTitles.includes(title) ? "default" : "outline"}
                  className="cursor-pointer text-xs py-1 px-2 hover:opacity-80 transition-opacity"
                  onClick={() => toggleTitle(title)}
                >
                  {title}
                </Badge>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Add custom title..."
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => e.key === "Enter" && addCustomTitle()}
              />
              <Button size="sm" variant="outline" onClick={addCustomTitle} className="h-8">
                Add
              </Button>
            </div>

            {selectedTitles.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedTitles.map((t) => (
                  <Badge key={t} className="text-xs gap-1">
                    {t}
                    <button onClick={() => toggleTitle(t)} className="ml-1 hover:text-red-300">&times;</button>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Enrich button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleEnrich}
          disabled={loading || !companiesText.trim() || !selectedTitles.length}
          className="gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Enriching..." : "Enrich Contacts"}
        </Button>

        {error && (
          <span className="text-sm text-red-500 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            {error}
          </span>
        )}
      </div>

      {/* Search errors */}
      {searchErrors.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50/50">
          <CardContent className="py-3">
            <p className="text-sm font-medium text-yellow-700 mb-1">Some searches had issues:</p>
            <ul className="text-xs text-yellow-600 space-y-0.5">
              {searchErrors.map((e, i) => (
                <li key={i}>- {e}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {contacts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                {contacts.length} Contacts Found
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Download Excel
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  Download CSV
                </Button>
                <Button size="sm" onClick={() => setCampaignDialogOpen(true)} className="gap-1">
                  <Send className="h-3.5 w-3.5" />
                  Send to Campaign
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Select all */}
            <div className="flex items-center gap-2 pb-3 border-b mb-3">
              <Checkbox
                checked={selectedContactIds.size === contacts.length && contacts.length > 0}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-sm text-muted-foreground">
                {selectedContactIds.size > 0 ? `${selectedContactIds.size} selected` : "Select all"}
              </span>
            </div>

            {/* Contact list */}
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                    selectedContactIds.has(contact.id) ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <Checkbox
                    checked={selectedContactIds.has(contact.id)}
                    onCheckedChange={() => toggleContactSelection(contact.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{contact.name}</p>
                        <p className="text-xs text-muted-foreground">{contact.title}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {contact.company_name}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      {contact.email && (
                        <span className={contact.email_status === "verified" ? "text-green-600" : ""}>
                          {contact.email}
                          {contact.email_status === "verified" && (
                            <CheckCircle className="inline h-3 w-3 ml-0.5" />
                          )}
                        </span>
                      )}
                      {contact.phone && <span>{contact.phone}</span>}
                      {contact.linkedin_url && (
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline"
                        >
                          LinkedIn
                        </a>
                      )}
                      {contact.city && <span>{[contact.city, contact.country].filter(Boolean).join(", ")}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Send to Campaign Dialog */}
      <AlertDialog open={campaignDialogOpen} onOpenChange={setCampaignDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Contacts to Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedContactIds.size > 0
                ? `Send ${selectedContactIds.size} selected contacts`
                : `Send all ${contacts.filter((c) => c.email).length} contacts with emails`}{" "}
              to an email campaign.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a campaign..." />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {campaigns.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                No campaigns found. Create a campaign first.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendingToCampaign}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSendToCampaign}
              disabled={!selectedCampaignId || sendingToCampaign}
            >
              {sendingToCampaign ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
