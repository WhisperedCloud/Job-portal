import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Progress } from '../ui/progress';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { 
  User, FileText, Calendar, Mail, Phone, MapPin, Download, 
  Eye, Loader2, TrendingUp, CheckCircle, XCircle, Sparkles, Calendar as CalendarIcon,
  Briefcase, GraduationCap, Award
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Application {
  id: string;
  job_id: string;
  candidate_id: string;
  status: string;
  applied_at: string;
  cover_letter?: string;
  interview_date?: string;
  interview_location?: string;
  interview_notes?: string;
  job?: {
    id: string;
    title: string;
    job_description: string;
  };
  candidate?: {
    id: string;
    name: string;
    phone?: string;
    location?: string;
    skills: string[];
    resume_url?: string;
    education?: string;
    experience?: string;
    license_type?: string;
    license_number?: string;
  };
  analysis?: {
    overall_match_score: number;
    key_skills_matched: string[];
    missing_skills: string[];
    summary: string;
    created_at: string;
  };
}

const RecruiterApplications = () => {
  const { user } = useAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [selectedJob, setSelectedJob] = useState('all');
  const [selectedResume, setSelectedResume] = useState<string | null>(null);
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [sortByScore, setSortByScore] = useState(false);
  const [isInterviewModalOpen, setIsInterviewModalOpen] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [interviewData, setInterviewData] = useState({
    interview_date: '',
    interview_time: '',
    interview_location: '',
    interview_notes: '',
  });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Application['candidate'] | null>(null);

  useEffect(() => {
    fetchApplications();
  }, [user]);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      
      // Get recruiter profile
      const { data: recruiterData, error: recruiterError } = await supabase
        .from('recruiters')
        .select('id')
        .eq('user_id', user?.id)
        .single();

      if (recruiterError) throw recruiterError;

      // Fetch applications for this recruiter's jobs
      const { data, error } = await supabase
        .from('applications')
        .select(`
          *,
          job:jobs!inner (
            id,
            title,
            job_description,
            recruiter_id
          ),
          candidate:candidates (
            id,
            name,
            phone,
            location,
            skills,
            resume_url,
            education,
            experience,
            license_type,
            license_number
          )
        `)
        .eq('job.recruiter_id', recruiterData.id)
        .order('applied_at', { ascending: false });

      if (error) throw error;

      // Fetch analysis results for each application
      const appsWithAnalysis = await Promise.all(
        (data || []).map(async (app) => {
          const { data: analysisData } = await supabase
            .from('analysis_results')
            .select('*')
            .eq('application_id', app.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          return {
            ...app,
            analysis: analysisData || null
          };
        })
      );

      setApplications(appsWithAnalysis);
    } catch (error) {
      console.error('Error fetching applications:', error);
      toast.error('Failed to load applications');
    } finally {
      setLoading(false);
    }
  };

  const analyzeResume = async (application: Application) => {
    if (!application.candidate?.resume_url || !application.job) {
      toast.error('Resume or job description not available');
      return;
    }

    try {
      setAnalyzing(application.id);
      
      console.log('Step 1: Extracting text from resume...');
      
      const resumeResponse = await fetch(application.candidate.resume_url);
      
      if (!resumeResponse.ok) {
        throw new Error('Failed to fetch resume file');
      }

      const blob = await resumeResponse.blob();
      const base64Resume = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          const base64Content = base64String.split(',')[1];
          resolve(base64Content);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      console.log(`Extracted resume text length: ${base64Resume.length}`);

      if (!base64Resume || base64Resume.length === 0) {
        throw new Error('Could not extract text from resume. The file may be empty or corrupted.');
      }

      console.log('Step 2: Calling analyze-resume edge function...');

      const { data, error } = await supabase.functions.invoke('analyze-resume', {
        body: {
          resumeBase64: base64Resume,
          mimeType: blob.type,
          jobDescription: application.job.job_description,
          applicationId: application.id
        }
      });

      if (error) throw error;

      console.log('✅ Analysis completed successfully!');
      toast.success('Resume analyzed successfully!');
      
      await fetchApplications();
      
    } catch (error: any) {
      console.error('❌ Error in analyzeResume:', error);
      toast.error(`Failed to analyze resume: ${error.message}`);
      throw error;
    } finally {
      setAnalyzing(null);
    }
  };

  const analyzeAllResumes = async () => {
    const applicationsToAnalyze = filteredApplications.filter(
      app => !app.analysis && app.candidate?.resume_url
    );

    if (applicationsToAnalyze.length === 0) {
      toast.info('All resumes have already been analyzed!');
      return;
    }

    setAnalyzingAll(true);
    setAnalysisProgress({ current: 0, total: applicationsToAnalyze.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < applicationsToAnalyze.length; i++) {
      const app = applicationsToAnalyze[i];
      setAnalysisProgress({ current: i + 1, total: applicationsToAnalyze.length });
      
      try {
        await analyzeResume(app);
        successCount++;
      } catch (error) {
        console.error(`Failed to analyze resume for ${app.candidate?.name}:`, error);
        failCount++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setAnalyzingAll(false);
    setAnalysisProgress({ current: 0, total: 0 });
    
    setSortByScore(true);
    
    toast.success(
      `Analysis complete! ${successCount} resumes analyzed successfully${failCount > 0 ? `, ${failCount} failed` : ''}.`
    );

    await fetchApplications();
  };

  const scheduleInterview = async () => {
    if (!selectedApplication || !interviewData.interview_date || !interviewData.interview_time) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const interviewDateTime = new Date(`${interviewData.interview_date}T${interviewData.interview_time}`);

      const { error } = await supabase
        .from('applications')
        .update({
          status: 'interview_scheduled',
          interview_date: interviewDateTime.toISOString(),
          interview_location: interviewData.interview_location,
          interview_notes: interviewData.interview_notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedApplication.id);

      if (error) throw error;

      toast.success('Interview scheduled successfully!');
      setIsInterviewModalOpen(false);
      setSelectedApplication(null);
      setInterviewData({
        interview_date: '',
        interview_time: '',
        interview_location: '',
        interview_notes: '',
      });
      await fetchApplications();
    } catch (error) {
      console.error('Error scheduling interview:', error);
      toast.error('Failed to schedule interview');
    }
  };

  const updateApplicationStatus = async (applicationId: string, status: string) => {
    try {
      const { error } = await supabase
        .from('applications')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', applicationId);

      if (error) throw error;

      toast.success(`Application ${status}`);
      await fetchApplications();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update application status');
    }
  };

  const viewCandidateProfile = async (candidate: Application['candidate'], candidateId: string) => {
    setSelectedCandidate(candidate);
    setIsProfileModalOpen(true);

    // Track profile view
    try {
      console.log('=== Tracking Profile View ===');
      console.log('User ID:', user?.id);
      console.log('Candidate ID:', candidateId);

      // Get recruiter profile
      const { data: recruiterData, error: recruiterError } = await supabase
        .from('recruiters')
        .select('id')
        .eq('user_id', user?.id)
        .single();

      console.log('Recruiter Data:', recruiterData);
      console.log('Recruiter Error:', recruiterError);

      if (recruiterError) {
        console.error('Error fetching recruiter:', recruiterError);
        return;
      }

      if (recruiterData && candidateId) {
        console.log('Inserting profile view...');
        console.log('Candidate ID:', candidateId);
        console.log('Recruiter ID:', recruiterData.id);

        // Insert profile view
        const { data: insertData, error: insertError } = await supabase
          .from('profile_views')
          .insert({
            candidate_id: candidateId,
            recruiter_id: recruiterData.id
          })
          .select();

        console.log('Insert Data:', insertData);
        console.log('Insert Error:', insertError);

        if (insertError) {
          // Ignore duplicate constraint errors (same recruiter viewing same profile on same day)
          if (insertError.code === '23505') {
            console.log('Profile already viewed today');
          } else {
            console.error('Error inserting profile view:', insertError);
          }
        } else {
          console.log('✅ Profile view tracked successfully!');
        }
      }
    } catch (error) {
      console.error('❌ Error in viewCandidateProfile:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'applied':
        return 'bg-blue-100 text-blue-800';
      case 'under_review':
        return 'bg-yellow-100 text-yellow-800';
      case 'interview_scheduled':
        return 'bg-purple-100 text-purple-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'hired':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBadge = (score: number) => {
    if (score >= 80) return 'bg-green-100 text-green-800';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  let filteredApplications = selectedJob === 'all' 
    ? applications 
    : applications.filter(app => app.job?.id === selectedJob);

  if (sortByScore) {
    filteredApplications = [...filteredApplications].sort((a, b) => {
      const scoreA = a.analysis?.overall_match_score || 0;
      const scoreB = b.analysis?.overall_match_score || 0;
      return scoreB - scoreA;
    });
  }

  const unanalyzedCount = filteredApplications.filter(app => !app.analysis && app.candidate?.resume_url).length;
  const analyzedCount = filteredApplications.filter(app => app.analysis).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Applications</h1>
          <p className="text-muted-foreground mt-2">
            Review and manage candidate applications
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {filteredApplications.length} applications
          {analyzedCount > 0 && (
            <span className="ml-2 text-green-600">
              ({analyzedCount} analyzed)
            </span>
          )}
        </div>
      </div>

      {/* Filter and Analyze All */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-4 items-center justify-between">
            <div className="flex gap-4 items-center">
              <Select value={selectedJob} onValueChange={(value) => {
                setSelectedJob(value);
                setSortByScore(false);
              }}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Filter by job" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Jobs</SelectItem>
                  {Array.from(new Set(applications.map(a => a.job?.id)))
                    .filter(Boolean)
                    .map(jobId => {
                      const app = applications.find(a => a.job?.id === jobId);
                      return (
                        <SelectItem key={jobId} value={jobId!}>
                          {app?.job?.title}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>

              {analyzedCount > 0 && (
                <Button
                  variant={sortByScore ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortByScore(!sortByScore)}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  {sortByScore ? 'Sorted by Score' : 'Sort by Match Score'}
                </Button>
              )}
            </div>

            {unanalyzedCount > 0 && (
              <div className="flex items-center gap-3">
                {analyzingAll && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      Analyzing {analysisProgress.current} of {analysisProgress.total}...
                    </span>
                  </div>
                )}
                <Button
                  onClick={analyzeAllResumes}
                  disabled={analyzingAll}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  {analyzingAll ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing All...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Analyze All Resumes ({unanalyzedCount})
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {analyzingAll && (
            <div className="mt-4">
              <Progress 
                value={(analysisProgress.current / analysisProgress.total) * 100} 
                className="h-2"
              />
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Processing resumes... This may take a few minutes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Applications List */}
      <div className="space-y-4">
        {filteredApplications.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No applications found</p>
            </CardContent>
          </Card>
        ) : (
          filteredApplications.map((application, index) => (
            <Card key={application.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {sortByScore && application.analysis && (
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 text-purple-700 font-bold text-lg">
                          #{index + 1}
                        </div>
                      )}
                      <div>
                        <h3 className="text-xl font-semibold">{application.candidate?.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          Applied for: {application.job?.title}
                        </p>
                      </div>
                      <Badge className={getStatusColor(application.status)}>
                        {application.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      {application.status === 'applied' && (
                        <>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => updateApplicationStatus(application.id, 'under_review')}
                          >
                            Under Review
                          </Button>
                          <Button 
                            size="sm" 
                            variant="default"
                            onClick={() => {
                              setSelectedApplication(application);
                              setIsInterviewModalOpen(true);
                            }}
                          >
                            <CalendarIcon className="h-4 w-4 mr-2" />
                            Schedule Interview
                          </Button>
                          <Button 
                            size="sm" 
                            variant="destructive"
                            onClick={() => updateApplicationStatus(application.id, 'rejected')}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {application.status === 'under_review' && (
                        <>
                          <Button 
                            size="sm" 
                            variant="default"
                            onClick={() => {
                              setSelectedApplication(application);
                              setIsInterviewModalOpen(true);
                            }}
                          >
                            <CalendarIcon className="h-4 w-4 mr-2" />
                            Schedule Interview
                          </Button>
                          <Button 
                            size="sm" 
                            variant="destructive"
                            onClick={() => updateApplicationStatus(application.id, 'rejected')}
                          >
                            Reject
                          </Button>
                          <Button 
                            size="sm"
                            onClick={() => updateApplicationStatus(application.id, 'hired')}
                          >
                            Hire
                          </Button>
                        </>
                      )}
                      {application.status === 'interview_scheduled' && (
                        <>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => updateApplicationStatus(application.id, 'hired')}
                          >
                            Hire
                          </Button>
                          <Button 
                            size="sm" 
                            variant="destructive"
                            onClick={() => updateApplicationStatus(application.id, 'rejected')}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Interview Details */}
                  {application.status === 'interview_scheduled' && application.interview_date && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CalendarIcon className="h-5 w-5 text-purple-600" />
                        <span className="font-semibold text-purple-900">Interview Scheduled</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Date & Time</p>
                          <p className="font-medium">{new Date(application.interview_date).toLocaleString()}</p>
                        </div>
                        {application.interview_location && (
                          <div>
                            <p className="text-muted-foreground">Location</p>
                            <p className="font-medium">{application.interview_location}</p>
                          </div>
                        )}
                        {application.interview_notes && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground">Notes</p>
                            <p className="font-medium">{application.interview_notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* AI Analysis Score */}
                  {application.analysis ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-blue-600" />
                          <span className="font-semibold text-blue-900">AI Match Score</span>
                        </div>
                        <Badge className={getScoreBadge(application.analysis.overall_match_score)}>
                          {application.analysis.overall_match_score}% Match
                        </Badge>
                      </div>
                      
                      <Progress 
                        value={application.analysis.overall_match_score} 
                        className="h-2 mb-3"
                      />

                      <p className="text-sm text-gray-700 mb-3">
                        {application.analysis.summary}
                      </p>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-medium">Matched Skills</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {application.analysis.key_skills_matched.map((skill, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <XCircle className="h-4 w-4 text-red-600" />
                            <span className="text-sm font-medium">Missing Skills</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {application.analysis.missing_skills.map((skill, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => analyzeResume(application)}
                      disabled={analyzing === application.id || analyzingAll}
                    >
                      {analyzing === application.id ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <TrendingUp className="h-4 w-4 mr-2" />
                          Analyze Resume with AI
                        </>
                      )}
                    </Button>
                  )}

                  {/* Candidate Details */}
                  <div className="grid grid-cols-2 gap-4 border-t pt-4">
                    <div>
                      <h4 className="font-semibold mb-2">Contact Information</h4>
                      <div className="space-y-2 text-sm">
                        {application.candidate?.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span>{application.candidate.phone}</span>
                          </div>
                        )}
                        {application.candidate?.location && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span>{application.candidate.location}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span>Applied {new Date(application.applied_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">Skills</h4>
                      <div className="flex flex-wrap gap-1">
                        {application.candidate?.skills.map((skill, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Cover Letter */}
                  {application.cover_letter && (
                    <div className="border-t pt-4">
                      <h4 className="font-semibold mb-2">Cover Letter</h4>
                      <p className="text-sm text-muted-foreground">
                        {application.cover_letter}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="border-t pt-4 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => viewCandidateProfile(application.candidate, application.candidate_id)}
                    >
                      <User className="h-4 w-4 mr-2" />
                      View Full Profile
                    </Button>
                    {application.candidate?.resume_url && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedResume(application.candidate.resume_url!);
                            setIsResumeModalOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Resume
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(application.candidate?.resume_url, '_blank')}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download Resume
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Resume Preview Modal */}
      <Dialog open={isResumeModalOpen} onOpenChange={setIsResumeModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Resume Preview</DialogTitle>
          </DialogHeader>
          {selectedResume && (
            <div className="w-full h-[70vh]">
              <iframe
                src={selectedResume}
                className="w-full h-full border-0"
                title="Resume Preview"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Interview Scheduling Modal */}
      <Dialog open={isInterviewModalOpen} onOpenChange={setIsInterviewModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Interview</DialogTitle>
            <DialogDescription>
              Set up an interview with {selectedApplication?.candidate?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="interview_date">Interview Date *</Label>
              <Input
                id="interview_date"
                type="date"
                value={interviewData.interview_date}
                onChange={(e) => setInterviewData({ ...interviewData, interview_date: e.target.value })}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div>
              <Label htmlFor="interview_time">Interview Time *</Label>
              <Input
                id="interview_time"
                type="time"
                value={interviewData.interview_time}
                onChange={(e) => setInterviewData({ ...interviewData, interview_time: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="interview_location">Location / Meeting Link</Label>
              <Input
                id="interview_location"
                placeholder="Office address or video call link"
                value={interviewData.interview_location}
                onChange={(e) => setInterviewData({ ...interviewData, interview_location: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="interview_notes">Notes (Optional)</Label>
              <Textarea
                id="interview_notes"
                placeholder="Additional instructions for the candidate"
                value={interviewData.interview_notes}
                onChange={(e) => setInterviewData({ ...interviewData, interview_notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInterviewModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={scheduleInterview}>
              Schedule Interview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Candidate Profile Modal */}
      <Dialog open={isProfileModalOpen} onOpenChange={setIsProfileModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-6 w-6" />
              Candidate Profile
            </DialogTitle>
            <DialogDescription>
              Complete profile information for {selectedCandidate?.name}
            </DialogDescription>
          </DialogHeader>
          
          {selectedCandidate && (
            <div className="space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <User className="h-5 w-5 text-blue-600" />
                  Basic Information
                </h3>
                <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Full Name</p>
                    <p className="font-medium">{selectedCandidate.name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p className="font-medium">{selectedCandidate.phone || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">{selectedCandidate.location || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Education */}
              {selectedCandidate.education && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-green-600" />
                    Education
                  </h3>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm whitespace-pre-wrap">{selectedCandidate.education}</p>
                  </div>
                </div>
              )}

              {/* Experience */}
              {selectedCandidate.experience && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-purple-600" />
                    Work Experience
                  </h3>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm whitespace-pre-wrap">{selectedCandidate.experience}</p>
                  </div>
                </div>
              )}

              {/* Skills */}
              {selectedCandidate.skills && selectedCandidate.skills.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Award className="h-5 w-5 text-orange-600" />
                    Skills
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedCandidate.skills.map((skill, idx) => (
                      <Badge key={idx} variant="secondary" className="text-sm">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* License Information */}
              {(selectedCandidate.license_type || selectedCandidate.license_number) && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-red-600" />
                    License Information
                  </h3>
                  <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                    {selectedCandidate.license_type && (
                      <div>
                        <p className="text-sm text-muted-foreground">License Type</p>
                        <p className="font-medium">{selectedCandidate.license_type}</p>
                      </div>
                    )}
                    {selectedCandidate.license_number && (
                      <div>
                        <p className="text-sm text-muted-foreground">License Number</p>
                        <p className="font-medium">{selectedCandidate.license_number}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Resume */}
              {selectedCandidate.resume_url && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Resume</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedResume(selectedCandidate.resume_url!);
                        setIsResumeModalOpen(true);
                        setIsProfileModalOpen(false);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Resume
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => window.open(selectedCandidate.resume_url, '_blank')}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download Resume
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProfileModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecruiterApplications;