import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AdminActionRequest {
  action: 'reset_password' | 'ban_user' | 'unban_user' | 'change_role' | 'delete_user';
  userId: string;
  data?: {
    duration?: '1day' | '1week' | '1month' | 'permanent';
    newRole?: 'candidate' | 'recruiter' | 'admin';
    reason?: string;
  };
}

interface ActionResponse {
  success: boolean;
  message?: string;
  data?: any;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, userId, data }: AdminActionRequest = await req.json();
    
    if (!action || !userId) {
      throw new Error('Missing required parameters: action and userId');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    console.log(`[${new Date().toISOString()}] Action: ${action} | User: ${userId}`);

    let result: ActionResponse = { success: false };

    switch (action) {
      case 'reset_password':
        result = await handleResetPassword(supabase, userId);
        break;

      case 'ban_user':
        if (!data?.duration) {
          throw new Error('Ban duration is required');
        }
        result = await handleBanUser(supabase, userId, data.duration, data.reason);
        break;

      case 'unban_user':
        result = await handleUnbanUser(supabase, userId);
        break;

      case 'change_role':
        if (!data?.newRole) {
          throw new Error('New role is required');
        }
        result = await handleChangeRole(supabase, userId, data.newRole);
        break;

      case 'delete_user':
        result = await handleDeleteUser(supabase, userId);
        break;

      default:
        throw new Error(`Invalid action: ${action}`);
    }

    console.log(`[${new Date().toISOString()}] ✅ Success:`, result.message);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] ❌ Error:`, err.message);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: err.message || 'Admin action failed',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});

// ==================== HANDLER FUNCTIONS ====================

async function handleResetPassword(supabase: any, userId: string): Promise<ActionResponse> {
  console.log('🔐 Initiating password reset...');

  // Get user's email
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  
  if (userError || !userData?.user?.email) {
    throw new Error('User not found or email not available');
  }

  console.log(`📧 Sending reset email to: ${userData.user.email}`);

  // Send password reset email
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(
    userData.user.email,
    {
      redirectTo: `${SUPABASE_URL.replace('.supabase.co', '')}/reset-password`,
    }
  );

  if (resetError) {
    throw new Error(`Failed to send reset email: ${resetError.message}`);
  }

  return { 
    success: true, 
    message: `Password reset email sent to ${userData.user.email}`,
    data: { email: userData.user.email }
  };
}

async function handleBanUser(
  supabase: any, 
  userId: string, 
  duration: string,
  reason?: string
): Promise<ActionResponse> {
  console.log(`🚫 Banning user for: ${duration}`);

  const now = new Date();
  let banUntil: Date;

  switch (duration) {
    case '1day':
      banUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      break;
    case '1week':
      banUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case '1month':
      banUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      break;
    case 'permanent':
      banUntil = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      throw new Error('Invalid ban duration');
  }

  console.log(`⏰ Ban until: ${banUntil.toISOString()}`);

  // Get current user data
  const { data: currentUserData, error: getUserError } = await supabase.auth.admin.getUserById(userId);
  
  if (getUserError) {
    throw new Error(`Failed to get user: ${getUserError.message}`);
  }

  // Update user with ban metadata
  const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...currentUserData.user.app_metadata,
      banned: true,
      banned_until: banUntil.toISOString(),
      banned_at: now.toISOString(),
      ban_reason: reason || 'No reason provided',
      ban_duration: duration,
    },
  });

  if (updateError) {
    throw new Error(`Failed to ban user: ${updateError.message}`);
  }

  // Try to create notification (non-critical)
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'account_banned',
      title: '🚫 Account Suspended',
      message: `Your account has been suspended until ${banUntil.toLocaleDateString()}.\n\nReason: ${reason || 'Policy violation'}`,
      created_at: now.toISOString(),
    });
  } catch (notifError) {
    console.warn('⚠️ Could not create ban notification:', notifError);
  }

  return { 
    success: true, 
    message: `User banned until ${banUntil.toISOString()}`,
    data: { 
      banned_until: banUntil.toISOString(),
      duration,
      reason 
    }
  };
}

async function handleUnbanUser(supabase: any, userId: string): Promise<ActionResponse> {
  console.log('✅ Unbanning user...');
  
  // Get current user data
  const { data: bannedUserData, error: getUserError } = await supabase.auth.admin.getUserById(userId);
  
  if (getUserError) {
    throw new Error(`Failed to get user: ${getUserError.message}`);
  }

  // Remove ban from app_metadata
  const { data: unbanData, error: unbanError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...bannedUserData.user.app_metadata,
      banned: false,
      banned_until: null,
      unbanned_at: new Date().toISOString(),
      ban_reason: null,
    },
  });

  if (unbanError) {
    throw new Error(`Failed to unban user: ${unbanError.message}`);
  }

  // Try to create notification (non-critical)
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'account_unbanned',
      title: '✅ Account Restored',
      message: 'Your account has been restored. You can now access all features.',
      created_at: new Date().toISOString(),
    });
  } catch (notifError) {
    console.warn('⚠️ Could not create unban notification:', notifError);
  }

  return { 
    success: true, 
    message: 'User unbanned successfully',
    data: unbanData 
  };
}

async function handleChangeRole(
  supabase: any, 
  userId: string, 
  newRole: string
): Promise<ActionResponse> {
  console.log(`🎭 Changing role to: ${newRole}`);

  // Get current role
  const { data: currentUserRoles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  const oldRole = currentUserRoles?.role;

  if (oldRole === newRole) {
    return { 
      success: true, 
      message: 'User already has this role',
      data: { role: newRole } 
    };
  }

  console.log(`🔄 Role change: ${oldRole} → ${newRole}`);

  // Update user_roles table
  const { error: roleError } = await supabase
    .from('user_roles')
    .update({ 
      role: newRole, 
      updated_at: new Date().toISOString() 
    })
    .eq('user_id', userId);

  if (roleError) {
    throw new Error(`Failed to update role: ${roleError.message}`);
  }

  // Update user metadata
  const { error: metadataError } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { role: newRole },
  });

  if (metadataError) {
    throw new Error(`Failed to update metadata: ${metadataError.message}`);
  }

  // Get user's name
  let userName = 'User';
  if (oldRole === 'candidate') {
    const { data: candidateData } = await supabase
      .from('candidates')
      .select('name')
      .eq('user_id', userId)
      .single();
    userName = candidateData?.name || 'User';
  } else if (oldRole === 'recruiter') {
    const { data: recruiterData } = await supabase
      .from('recruiters')
      .select('company_name, name')
      .eq('user_id', userId)
      .single();
    userName = recruiterData?.name || recruiterData?.company_name || 'User';
  }

  // Handle profile creation for new role
  if (newRole === 'recruiter' && oldRole === 'candidate') {
    await createRecruiterProfile(supabase, userId, userName);
  } else if (newRole === 'candidate' && oldRole === 'recruiter') {
    await createCandidateProfile(supabase, userId, userName);
  }

  // Create notification
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'role_changed',
      title: '🎭 Role Updated',
      message: `Your account role has been changed from ${oldRole} to ${newRole}.\n\nPlease log out and log back in to see changes.`,
      created_at: new Date().toISOString(),
    });
  } catch (notifError) {
    console.warn('⚠️ Could not create role change notification:', notifError);
  }

  return { 
    success: true, 
    message: `Role changed from ${oldRole} to ${newRole}`,
    data: { oldRole, newRole, userName }
  };
}

async function handleDeleteUser(supabase: any, userId: string): Promise<ActionResponse> {
  console.log('🗑️ Deleting user and all related data...');

  try {
    // Delete in order (respect foreign key constraints)
    await supabase.from('applications').delete().eq('candidate_id', userId);
    await supabase.from('analysis_results').delete().match({ application_id: userId });
    await supabase.from('user_roles').delete().eq('user_id', userId);
    await supabase.from('candidates').delete().eq('user_id', userId);
    await supabase.from('recruiters').delete().eq('user_id', userId);
    await supabase.from('notifications').delete().eq('user_id', userId);
    
    // Delete user from auth (this cascades to related tables)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    
    if (deleteError) {
      throw new Error(`Failed to delete user: ${deleteError.message}`);
    }

    return { 
      success: true, 
      message: 'User and all related data deleted successfully' 
    };
  } catch (error: any) {
    throw new Error(`Delete operation failed: ${error.message}`);
  }
}

// ==================== HELPER FUNCTIONS ====================

async function createRecruiterProfile(supabase: any, userId: string, name: string) {
  const { data: existingRecruiter } = await supabase
    .from('recruiters')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (!existingRecruiter) {
    await supabase.from('recruiters').insert({
      user_id: userId,
      company_name: name,
      name: name,
      created_at: new Date().toISOString(),
    });
    console.log('✅ Recruiter profile created');
  }
}

async function createCandidateProfile(supabase: any, userId: string, name: string) {
  const { data: existingCandidate } = await supabase
    .from('candidates')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (!existingCandidate) {
    await supabase.from('candidates').insert({
      user_id: userId,
      name: name,
      skills: [],
      created_at: new Date().toISOString(),
    });
    console.log('✅ Candidate profile created');
  }
}
