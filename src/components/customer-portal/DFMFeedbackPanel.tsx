import { useState } from 'react';
import { AlertTriangle, XCircle, Info, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface DFMIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  recommendation?: string;
}

interface DFMFeedbackPanelProps {
  issues: DFMIssue[];
  partName?: string;
}

const severityConfig = {
  error: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-50 border-red-200',
    badgeBg: 'bg-red-100 text-red-700 border-red-200',
    label: 'Error',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-500',
    bg: 'bg-amber-50 border-amber-200',
    badgeBg: 'bg-amber-100 text-amber-700 border-amber-200',
    label: 'Warning',
  },
  info: {
    icon: Info,
    color: 'text-blue-500',
    bg: 'bg-blue-50 border-blue-200',
    badgeBg: 'bg-blue-100 text-blue-700 border-blue-200',
    label: 'Info',
  },
};

const DFMFeedbackPanel = ({ issues, partName }: DFMFeedbackPanelProps) => {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  const toggleItem = (id: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const sortedIssues = [...issues].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="h-5 w-5" />
          DFM Analysis
          {partName && (
            <span className="text-sm font-normal text-muted-foreground">
              — {partName}
            </span>
          )}
        </CardTitle>

        {/* Summary line */}
        {issues.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {issues.length} issue{issues.length !== 1 ? 's' : ''} found:
            </span>
            {errorCount > 0 && (
              <Badge variant="outline" className={severityConfig.error.badgeBg}>
                {errorCount} error{errorCount !== 1 ? 's' : ''}
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="outline" className={severityConfig.warning.badgeBg}>
                {warningCount} warning{warningCount !== 1 ? 's' : ''}
              </Badge>
            )}
            {infoCount > 0 && (
              <Badge variant="outline" className={severityConfig.info.badgeBg}>
                {infoCount} info
              </Badge>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            No issues found — part passes all DFM checks.
          </div>
        )}
      </CardHeader>

      {sortedIssues.length > 0 && (
        <CardContent className="flex flex-col gap-2">
          {sortedIssues.map((issue) => {
            const config = severityConfig[issue.severity];
            const Icon = config.icon;
            const isOpen = openItems.has(issue.id);

            return (
              <Collapsible
                key={issue.id}
                open={isOpen}
                onOpenChange={() => toggleItem(issue.id)}
              >
                <div className={`rounded-lg border ${config.bg}`}>
                  <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <Icon className={`h-5 w-5 flex-shrink-0 ${config.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-[11px] px-1.5 py-0"
                        >
                          {issue.category}
                        </Badge>
                        <span className="text-sm font-medium">{issue.title}</span>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    )}
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="border-t px-4 py-3 text-sm">
                      <p className="text-muted-foreground">{issue.description}</p>
                      {issue.recommendation && (
                        <div className="mt-2 rounded-md bg-background/60 px-3 py-2">
                          <span className="font-medium">Recommendation: </span>
                          <span className="text-muted-foreground">
                            {issue.recommendation}
                          </span>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
};

export default DFMFeedbackPanel;
