"""Builds demo/meta.json: a representative copy of the Merkava process metadata
(field names, types, allowed values, form layout). Used by demo mode and tests."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

F = {}  # ref -> (name, type, isIdentity)
def fdef(ref, name, typ="string", ident=False): F[ref] = (name, typ, ident)
for r, n, t, i in [
 ("System.Title","Title","string",False),("System.State","State","string",False),("System.Reason","Reason","string",False),
 ("System.AssignedTo","Assigned To","string",True),("System.AreaPath","Area Path","treePath",False),("System.IterationPath","Iteration Path","treePath",False),
 ("System.Description","Description","html",False),("System.Tags","Tags","plainText",False),("System.History","History","history",False),
 ("System.IterationId","Iteration ID","integer",False),("System.AreaId","Area ID","integer",False),("System.TeamProject","Team Project","string",False),
 ("System.WorkItemType","Work Item Type","string",False),("System.ChangedBy","Changed By","string",True),("System.CreatedDate","Created Date","dateTime",False),
 ("Microsoft.VSTS.Common.Priority","Priority","integer",False),("Microsoft.VSTS.Common.ValueArea","Value Area","string",False),
 ("Microsoft.VSTS.Common.Activity","Activity","string",False),("Microsoft.VSTS.Common.StackRank","Stack Rank","double",False),
 ("Microsoft.VSTS.Common.ClosedDate","Closed Date","dateTime",False),("Microsoft.VSTS.Common.Severity","Severity","string",False),
 ("Microsoft.VSTS.Common.AcceptanceCriteria","Acceptance Criteria","html",False),
 ("Microsoft.VSTS.Scheduling.StoryPoints","Story Points","double",False),("Microsoft.VSTS.Scheduling.StartDate","Start Date","dateTime",False),
 ("Microsoft.VSTS.Scheduling.TargetDate","Target Date","dateTime",False),("Microsoft.VSTS.Scheduling.RemainingWork","Remaining Work","double",False),
 ("Microsoft.VSTS.Scheduling.OriginalEstimate","Original Estimate","double",False),("Microsoft.VSTS.Scheduling.CompletedWork","Completed Work","double",False),
 ("Microsoft.VSTS.TCM.ReproSteps","Repro Steps","html",False),
 ("Microsoft.VSTS.CMMI.Minutes","Minutes","html",False),("Microsoft.VSTS.CMMI.MitigationPlan","Mitigation Plan","html",False),
 ("Microsoft.VSTS.CMMI.ActualAttendee2","Actual Attendee 2","string",True),
 ("Custom.ROIExplenation","ROI Explenation","html",False),("Custom.Solutionownername","Solution owner name","string",True),
 ("Custom.SolutionApproverName","Solution Approver Name","string",True),("Custom.TesterOwnerName","Tester Owner Name","string",True),
 ("Custom.InfrastructureOwner","Infrastructure Owner","string",True),("Custom.ArchitectureApproval","Architecture Approval","string",False),
 ("Custom.UXUIRequired","UX UI Required","string",False),("Custom.StoryPointsValues","Story Points Values","string",False),
 ("Custom.WSJFPriority","WSJF Priority","double",False),("Custom.LeadingSquad","Leading Squad","string",False),
 ("Custom.InfrastructureExpertise","Infrastructure Expertise","string",False),("Custom.Customer","Customer","string",False),
 ("Custom.Businesspriority","Business priority","string",False),("Custom.BusinessFocus","Business Focus","string",False),
 ("Custom.OperationFocus","Operation Focus","string",False),("Custom.MVP","MVP","string",False),("Custom.CR","CR","boolean",False),
 ("Custom.GovOffice","Gov Office","string",False),("Custom.DeliveryStage","Delivery Stage","string",False),("Custom.Commited1","Commited1","string",False),
 ("Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7","שובץ","boolean",False),("Custom.Deliveryrisk","Delivery risk","boolean",False),
 ("Custom.RiskLevel","Risk Level","string",False),("Custom.SystemModule","SystemModule","string",False),("Custom.Q","Q","integer",False),
 ("Custom.EmbeddedPI","Embedded PI","string",False),("Custom.ParentName","Parent Name","string",False),
 ("Custom.FoundInEnviroment1","Found In Enviroment1","string",False),("Custom.Relevance","Relevance","boolean",False),
 ("Custom.Reviewed","Reviewed","boolean",False),("Custom.EscapingDefect","Escaping Defect","boolean",False),("Custom.Reopen","Reopen","boolean",False),
 ("Custom.OSS","OSS","boolean",False),("Custom.TransportNumber","Transport Number","string",False),
 ("Custom.d3d0252f-48df-4329-8b93-585a2c0f8dae","דיוור למשתמשים","boolean",False),
]: fdef(r, n, t, i)
READONLY = {"System.CreatedDate"}

AV = {
 "Microsoft.VSTS.Common.Priority": ["1","2","3","4"],
 "Microsoft.VSTS.Common.ValueArea": ["Business","Container","Internal","Maintenance"],
 "Microsoft.VSTS.Common.Activity": ["Deployment","Design","Development","Documentation","Requirements","Testing"],
 "Microsoft.VSTS.Common.Severity": ["1 - Critical","2 - High","3 - Medium","4 - Low"],
 "Custom.ArchitectureApproval": ["Approved","Rejected"], "Custom.UXUIRequired": ["No","Yes"],
 "Custom.StoryPointsValues": ["01 = 1d","02 = 1-2d","03 = 2-4d","05 = 4-6d","08 = 6-10d","13 = 2-3W","20 = 3-5W","30 = 5-8W"],
 "Custom.LeadingSquad": ["Attendance","Car_Housing","CRM","CTO","Data & AI","Development","Finance","FM","HR_Core","Infrastructure","Logistics","Meteor","Payroll","Support","Training","UX/UI"],
 "Custom.InfrastructureExpertise": ["Basis","Cloud","Communication","DBA","Information security","Management","System","Technician"],
 "Custom.Customer": ["אגת","חשבונאות ודיווח","חשכל","מטה שכר","מימון ואשראי","נכסים ולוגיסטיקה","סיגמה"],
 "Custom.Businesspriority": ["03 - Very Low - לא ישפיע אם לא ידולוור","05 - Low - מינימום השפעה על תהליך עסקי","08 - Med - התהליך העסקי מושפע לא דרמטית","13 - High - No WA תהליך עסקי מושפע","20 - Very High - תהליך עסקי עיקרי יפגע","40 - Critical - אם לא יבוצע לא נעמוד בהתחייבות"],
 "Custom.BusinessFocus": ["No","Yes"], "Custom.OperationFocus": ["No","Yes"], "Custom.MVP": ["MVP1","MVP2","MVP3"],
 "Custom.GovOffice": ["הכנסת","מטה החשב הכללי","משרד האוצר"], "Custom.DeliveryStage": ["ליווי ותמיכה בלקוח","Delivery","Stage for Delivery"],
 "Custom.Commited1": ["No","Yes"], "Custom.RiskLevel": ["01 - High","02 - Medium","03- Low"],
 "Custom.SystemModule": ["דיגיטל","הרשאות","שכר","CRM","FI","HR ליבה","PM"], "Custom.Q": ["1","2","3","4"],
 "Custom.EmbeddedPI": ["Embedded For Delivery","Embedded For Work"],
 "Custom.FoundInEnviroment1": ["01 - DFR","02 - DGL","03 - DCR","05 - QMT","10 - Prod"],
}
STATES = {
 "Epic": [("New","Proposed"),("Features Breakdown","Proposed"),("Ready","Proposed"),("Active","InProgress"),("MVP ready","InProgress"),("Closed","Completed"),("Removed","Removed")],
 "Feature": [("New","Proposed"),("Req defintion","Proposed"),("Ready for solution","Proposed"),("Solution","Proposed"),("Story breakdown","Proposed"),("Ready","Proposed"),("Active","InProgress"),("Blocked","InProgress"),("Testing","InProgress"),("Ready to deploy","InProgress"),("Pilot","InProgress"),("Closed","Completed"),("Removed","Removed")],
 "User Story": [("New","Proposed"),("Ready","Proposed"),("Active","InProgress"),("Inactive","InProgress"),("Testing","InProgress"),("Ready to deploy","InProgress"),("Closed","Completed"),("Removed","Removed")],
 "Task": [("New","Proposed"),("Active","InProgress"),("Inactive","InProgress"),("Closed","Completed"),("Removed","Removed")],
 "Bug": [("New","Proposed"),("Active","InProgress"),("In Progress","InProgress"),("Ready","InProgress"),("Inactive","InProgress"),("Resolved","Resolved"),("Closed","Completed"),("Removed","Removed")],
}
REQ = {
 "Epic": ["System.Title","System.State","Microsoft.VSTS.Common.Priority","Microsoft.VSTS.Common.ValueArea","Custom.CR","Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7"],
 "Feature": ["System.Title","System.State","Microsoft.VSTS.Common.ValueArea","Custom.CR","Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7","Custom.Deliveryrisk","Custom.d3d0252f-48df-4329-8b93-585a2c0f8dae"],
 "User Story": ["System.Title","System.State","Microsoft.VSTS.Common.ValueArea","Custom.CR","Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7","Custom.Deliveryrisk"],
 "Task": ["System.Title","System.State"],
 "Bug": ["System.Title","System.State","Microsoft.VSTS.Common.ValueArea","Custom.Relevance","Custom.Reviewed","Custom.EscapingDefect","Custom.CR","Custom.Reopen","Custom.OSS"],
}
DEFAULTS = {"System.State":"New","Microsoft.VSTS.Common.ValueArea":"Business","Custom.CR":"0","Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7":"0","Custom.Deliveryrisk":"0","Custom.d3d0252f-48df-4329-8b93-585a2c0f8dae":"0","Custom.Relevance":"0","Custom.Reviewed":"0","Custom.EscapingDefect":"0","Custom.Reopen":"0","Custom.OSS":"0"}
SYSTEM_COMMON = ["System.IterationId","System.AreaId","System.TeamProject","System.WorkItemType","System.ChangedBy","System.History","System.CreatedDate","Microsoft.VSTS.Common.StackRank","Microsoft.VSTS.Common.ClosedDate"]
HEADER = ["System.Title","System.AssignedTo","System.State","System.Reason","System.AreaPath","System.IterationPath","System.Tags"]

def c(ref, label=None, ctype="FieldControl"): return {"id": ref, "label": label, "controlType": ctype, "visible": True}
LAYOUT = {
 "Feature": [("Details", [
   ("Description",[c("System.Description","Description","HtmlFieldControl")]),
   ("סיכומי דיון ומיילים",[c("Microsoft.VSTS.CMMI.Minutes","סיכומי דיון ומיילים","HtmlFieldControl")]),
   ("Expected Business Outcome",[c("Custom.ROIExplenation","Expected Business Outcome","HtmlFieldControl")]),
   ("Mitigation Plan",[c("Microsoft.VSTS.CMMI.MitigationPlan","Mitigation Plan","HtmlFieldControl")]),
   ("Planning",[c("Custom.Solutionownername","Solution owner name"),c("Custom.SolutionApproverName","Solution Approver Name"),c("Microsoft.VSTS.CMMI.ActualAttendee2","Dev Owner Name"),c("Custom.TesterOwnerName","Tester Owner Name"),c("Custom.InfrastructureOwner","Infrastructure Owner"),c("Custom.ArchitectureApproval","Solution Status (After DR)"),c("Custom.UXUIRequired","UX UI Required"),c("Custom.StoryPointsValues","Story Points Values"),c("Microsoft.VSTS.Scheduling.StoryPoints","Story Points"),c("Custom.WSJFPriority","ROI score (WSJF)")]),
   ("Product Line",[c("Custom.LeadingSquad","Leading Squad"),c("Custom.InfrastructureExpertise","Infrastructure Expertise"),c("Microsoft.VSTS.Common.ValueArea","Feature Type")]),
   ("Requirements",[c("Custom.Customer","לקוח מוביל"),c("Custom.Businesspriority","Business priority"),c("Custom.BusinessFocus","Business Focus"),c("Custom.OperationFocus","Operation Focus"),c("Custom.MVP","MVP"),c("Custom.CR","CR"),c("Custom.GovOffice","Gov Office")]),
   ("תכנית עבודה רבעונית",[c("Custom.d3d0252f-48df-4329-8b93-585a2c0f8dae",'דיוור ת"ע למשתמשים')]),
   ("לוחות זמנים",[c("System.CreatedDate","Created Date"),c("Microsoft.VSTS.Scheduling.StartDate","Active (start) Date"),c("Microsoft.VSTS.Scheduling.TargetDate","Target date"),c("Microsoft.VSTS.Common.ClosedDate","Closed Date")]),
   ("Delivery",[c("Custom.DeliveryStage","Delivery Stage"),c("Custom.Commited1","Commited"),c("Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7","Conflict/Issue"),c("Custom.Deliveryrisk","Delivery risk"),c("Custom.RiskLevel","Risk Level")]),
   ("Related Work",[c("Related Work","", "LinksControl")])]),
   ("CsM", [("CsM",[c("Microsoft.VSTS.Common.Activity","Activity"),c("Custom.SystemModule","SystemModule")])])],
 "User Story": [("Details", [
   ("Description",[c("System.Description","Description","HtmlFieldControl")]),
   ("סיכומי דיון ומיילים",[c("Microsoft.VSTS.CMMI.Minutes","סיכומי דיון ומיילים","HtmlFieldControl")]),
   ("Planning",[c("Custom.Customer","לקוח מוביל"),c("Microsoft.VSTS.CMMI.ActualAttendee2","Dev Owner Name"),c("Custom.TesterOwnerName","Tester Owner Name"),c("Custom.InfrastructureOwner","Infrastructure Owner"),c("Custom.WSJFPriority","ROI Score"),c("Custom.StoryPointsValues","Story Points Values"),c("Microsoft.VSTS.Scheduling.StoryPoints","Story Points"),c("Microsoft.VSTS.Common.Priority","Priority"),c("Custom.CR","CR"),c("Custom.GovOffice","Gov Office")]),
   ("Product Line",[c("Custom.LeadingSquad","Leading Squad"),c("Custom.InfrastructureExpertise","Infrastructure Expertise"),c("Microsoft.VSTS.Common.ValueArea","US Type")]),
   ("Delivery",[c("Custom.Commited1","Commited1"),c("Custom.Q","Delivery PI (Q)"),c("Custom.EmbeddedPI","Embedded PI"),c("Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7","Conflict/Issue"),c("Custom.Deliveryrisk","Delivery risk"),c("Custom.RiskLevel","Risk Level"),c("Custom.ParentName","Parent Name")])]),
   ("CsM", [("CsM",[c("Microsoft.VSTS.Common.Activity","Activity"),c("Custom.SystemModule","SystemModule")])])],
 "Epic": [("Details", [("Description",[c("System.Description","Description","HtmlFieldControl")]),
   ("Planning",[c("Microsoft.VSTS.Common.Priority","Priority"),c("Microsoft.VSTS.Scheduling.StartDate","Start Date"),c("Microsoft.VSTS.Scheduling.TargetDate","Target Date"),c("Microsoft.VSTS.Scheduling.StoryPoints","Story Points")]),
   ("Requirements",[c("Custom.Customer","לקוח מוביל"),c("Custom.Businesspriority","Business priority"),c("Microsoft.VSTS.Common.ValueArea","Value Area"),c("Custom.MVP","MVP"),c("Custom.CR","CR"),c("Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7","שובץ"),c("Custom.LeadingSquad","Leading Squad")])])],
 "Task": [("Details", [("Description",[c("System.Description","Description","HtmlFieldControl")]),
   ("Planning",[c("Microsoft.VSTS.Common.Priority","Priority"),c("Microsoft.VSTS.Common.Activity","Activity")]),
   ("Effort",[c("Microsoft.VSTS.Scheduling.OriginalEstimate","Original Estimate"),c("Microsoft.VSTS.Scheduling.RemainingWork","Remaining"),c("Microsoft.VSTS.Scheduling.CompletedWork","Completed")]),
   ("Other",[c("Custom.TransportNumber","Transport Number"),c("Custom.SystemModule","SystemModule")])])],
 "Bug": [("Details", [("Repro Steps",[c("Microsoft.VSTS.TCM.ReproSteps","Repro Steps","HtmlFieldControl")]),("Description",[c("System.Description","Description","HtmlFieldControl")]),
   ("Planning",[c("Microsoft.VSTS.Common.Priority","Priority"),c("Microsoft.VSTS.Common.Severity","Severity"),c("Microsoft.VSTS.Common.Activity","Activity"),c("Microsoft.VSTS.Scheduling.StoryPoints","Story Points"),c("Microsoft.VSTS.Common.ValueArea","Value Area")]),
   ("Classification",[c("Custom.FoundInEnviroment1","Found In Environment"),c("Custom.Relevance","Relevance"),c("Custom.Reviewed","Reviewed"),c("Custom.EscapingDefect","Escaping Defect"),c("Custom.CR","CR"),c("Custom.Reopen","Reopen"),c("Custom.OSS","OSS"),c("Custom.TransportNumber","Transport Number"),c("Custom.LeadingSquad","Leading Squad")])])],
}

def fields_on(t):
    refs = list(HEADER) + SYSTEM_COMMON
    for _, groups in LAYOUT[t]:
        for _, ctrls in groups:
            for x in ctrls:
                if x["id"] in F and x["id"] not in refs: refs.append(x["id"])
    extra = {"Feature":["Microsoft.VSTS.Common.Priority"],"User Story":["Microsoft.VSTS.Common.AcceptanceCriteria","Microsoft.VSTS.Scheduling.StartDate"],"Bug":["Microsoft.VSTS.Scheduling.RemainingWork"],"Epic":[],"Task":[]}[t]
    return refs + [e for e in extra if e not in refs]

out = {"fields": [{"referenceName": r, "name": n, "type": t, "readOnly": r in READONLY, "isIdentity": i, "isPicklist": r in AV} for r, (n, t, i) in F.items()],
       "workitemtypes": [], "processWits": [], "typeFields": {}, "layouts": {}}
for t in ["Epic","Feature","User Story","Task","Bug"]:
    wref = "Merkava." + t.replace(" ", "")
    out["workitemtypes"].append({"name": t, "referenceName": "Microsoft.VSTS.WorkItemTypes." + t.replace(" ",""), "isDisabled": False, "states": [{"name": s, "category": c_} for s, c_ in STATES[t]]})
    out["processWits"].append({"name": t, "referenceName": wref})
    tf = []
    for r in fields_on(t):
        av = [s for s,_ in STATES[t]] if r == "System.State" else AV.get(r, [])
        tf.append({"referenceName": r, "name": F[r][0], "alwaysRequired": r in REQ[t] or r in ("System.IterationId","System.AreaId"), "defaultValue": DEFAULTS.get(r), "allowedValues": av})
    out["typeFields"][t] = tf
    out["layouts"][t] = {"pages": [{"label": pl, "visible": True, "sections": [{"groups": [{"label": gl, "visible": True, "controls": ctrls} for gl, ctrls in groups]}]} for pl, groups in LAYOUT[t]],
                         "systemControls": [c("System.Title", ""), c("System.AssignedTo","Assi&gned To"), c("System.State","Stat&e"), c("System.Reason","Reason"), c("System.AreaPath","&Area"), c("System.IterationPath","Ite&ration"), c("System.History","History")]}
def node(name, kids=()): return {"name": name, "children": list(kids)} if kids else {"name": name}
out["classificationnodes"] = [
 {"structureType": "area", "name": "Portfolio Merkava", "children": [node("MK2", [node("Meteor", [node("Meteor Sigma"), node("Meteor Alpha")]), node("LOG", [node("LOGST")])]), node("Payroll")]},
 {"structureType": "iteration", "name": "Portfolio Merkava", "children": [node("PI3_26", [node("3.1"), node("3.2"), node("3.3")]), node("PI4_26", [node("4.1"), node("4.2"), node("4.3")])]}]
DATES = {"PI3_26": ("2026-07-01", "2026-09-30"), "3.1": ("2026-07-01", "2026-07-31"), "3.2": ("2026-08-01", "2026-08-31"), "3.3": ("2026-09-01", "2026-09-30"),
         "PI4_26": ("2026-10-01", "2026-12-31"), "4.1": ("2026-10-01", "2026-10-31"), "4.2": ("2026-11-01", "2026-11-30"), "4.3": ("2026-12-01", "2026-12-31")}
def _dates(n):
    if n["name"] in DATES: n["attributes"] = {"startDate": DATES[n["name"]][0] + "T00:00:00Z", "finishDate": DATES[n["name"]][1] + "T00:00:00Z"}
    for c in n.get("children", []): _dates(c)
_dates(out["classificationnodes"][1])
json.dump(out, open(os.path.join(ROOT, "demo", "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("ok", {t: len(v) for t, v in out["typeFields"].items()})
